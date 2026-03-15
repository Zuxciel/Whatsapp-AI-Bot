"use strict";

/**
 * aiClient.js
 * ───────────
 * Client untuk berkomunikasi dengan inference server Python.
 * - Retry logic dengan exponential backoff
 * - Health check sebelum inference
 * - Timeout handling
 */

const axios       = require("axios");
const { loadConfig } = require("../config");

let _serverReady = false;

function getAxios() {
  const cfg = loadConfig();
  return axios.create({
    baseURL: cfg.inference?.host || "http://localhost:8000",
    timeout: cfg.inference?.timeout || 120000,
    headers: { "Content-Type": "application/json" }
  });
}

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Cek apakah inference server sudah ready
 * @returns {Promise<boolean>}
 */
async function checkHealth() {
  try {
    const ax   = getAxios();
    const resp = await ax.get("/health", { timeout: 5000 });
    _serverReady = resp.data?.model_loaded === true;
    return _serverReady;
  } catch {
    _serverReady = false;
    return false;
  }
}

/**
 * Tunggu sampai inference server ready (dengan polling)
 * @param {number} maxWaitMs
 * @param {number} pollMs
 * @returns {Promise<boolean>}
 */
async function waitForServer(maxWaitMs = 180000, pollMs = 5000) {
  const start = Date.now();
  console.log("[AI] Menunggu inference server siap...");

  while (Date.now() - start < maxWaitMs) {
    const ready = await checkHealth();
    if (ready) {
      console.log("[AI] ✅ Inference server siap!");
      return true;
    }
    await sleep(pollMs);
  }

  console.error("[AI] ❌ Inference server tidak merespons dalam waktu yang ditentukan.");
  return false;
}

/**
 * Kirim request inference ke model
 * @param {Array<{role: string, content: string}>} messages
 * @param {Object} options
 * @returns {Promise<{text: string, thinking: string|null, tokensUsed: number, inferenceTimeMs: number}>}
 */
async function generateResponse(messages, options = {}) {
  const cfg        = loadConfig();
  const maxAttempts = cfg.inference?.retryAttempts ?? 3;
  const retryDelay  = cfg.inference?.retryDelayMs ?? 2000;

  const payload = {
    messages,
    max_tokens:      options.maxTokens    ?? cfg.model?.maxTokens    ?? 600,
    temperature:     options.temperature  ?? cfg.model?.temperature  ?? 0.75,
    top_p:           options.topP         ?? cfg.model?.topP         ?? 0.9,
    enable_thinking: options.enableThinking ?? cfg.model?.enableThinking ?? true
  };

  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const ax   = getAxios();
      const resp = await ax.post("/inference", payload);
      const data = resp.data;

      return {
        text:            data.text            || "",
        thinking:        data.thinking        || null,
        tokensUsed:      data.tokens_used     || 0,
        inferenceTimeMs: data.inference_time_ms || 0
      };

    } catch (err) {
      lastError = err;

      const isRetryable = !err.response || err.response.status >= 500 || err.code === "ECONNREFUSED";

      if (!isRetryable || attempt === maxAttempts) {
        break;
      }

      const backoff = retryDelay * Math.pow(2, attempt - 1);
      console.warn(`[AI] Inference gagal (attempt ${attempt}/${maxAttempts}). Retry dalam ${backoff}ms...`);
      await sleep(backoff);
    }
  }

  const errMsg = lastError?.response?.data?.detail || lastError?.message || "Unknown error";
  throw new Error(`[AI] Inference gagal setelah ${maxAttempts} percobaan: ${errMsg}`);
}

/**
 * Kirim request untuk analisis mood dari teks
 * @param {string[]} texts - array of pesan
 * @returns {Promise<{mood: string, reason: string}>}
 */
async function analyzeMood(texts) {
  const combined  = texts.slice(-5).join("\n");
  const messages  = [
    {
      role:    "system",
      content: `Kamu adalah AI yang menganalisis suasana hati dari percakapan.
Berikan respons HANYA dalam format JSON: {"mood":"<mood>","reason":"<alasan singkat>"}
Mood options: neutral, happy, curious, sad, angry, excited, bored, annoyed`
    },
    {
      role:    "user",
      content: `Analisis mood percakapan ini:\n${combined}\n\nJawab HANYA JSON.`
    }
  ];

  try {
    const result = await generateResponse(messages, {
      maxTokens:      100,
      temperature:    0.3,
      enableThinking: false
    });

    const jsonMatch = result.text.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch { /* fallback */ }

  return { mood: "neutral", reason: "Tidak bisa menganalisis" };
}

/**
 * Analisis gaya bahasa user untuk adaptive mirroring
 * @param {string[]} userMessages - pesan-pesan user
 * @returns {Promise<Object>} style profile
 */
async function analyzeUserStyle(userMessages) {
  const sample   = userMessages.slice(-10).join("\n---\n");
  const messages = [
    {
      role:    "system",
      content: `Kamu menganalisis gaya bahasa user.
Jawab HANYA dalam JSON:
{
  "avgMsgLength": <number>,
  "slangScore": <0.0-1.0>,
  "formalScore": <0.0-1.0>,
  "emojiFreq": <avg emoji per msg>,
  "langMix": "<id|en|mixed>",
  "tone": "<casual|formal|aggressive|friendly>",
  "styleDesc": "<deskripsi singkat gaya bahasa>",
  "examplePhrases": ["<phrase1>", "<phrase2>"]
}`
    },
    {
      role:    "user",
      content: `Analisis gaya bahasa:\n${sample}\n\nJawab HANYA JSON.`
    }
  ];

  try {
    const result = await generateResponse(messages, {
      maxTokens:      200,
      temperature:    0.2,
      enableThinking: false
    });

    const jsonMatch = result.text.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch { /* fallback */ }

  return {
    avgMsgLength:  50,
    slangScore:    0.3,
    formalScore:   0.3,
    emojiFreq:     0.2,
    langMix:       "id",
    tone:          "casual",
    styleDesc:     "Bahasa sehari-hari",
    examplePhrases: []
  };
}

/**
 * Minta AI untuk memutuskan apakah ingin mengirim pesan proaktif
 * @param {string} context - konteks terakhir percakapan
 * @param {string} mood - mood AI saat ini
 * @param {number} minutesSinceLast - menit sejak pesan terakhir
 * @returns {Promise<{wantProactive: boolean, message: string|null, delayMinutes: number}>}
 */
async function decideProactive(context, mood, minutesSinceLast) {
  const messages = [
    {
      role:    "system",
      content: `Kamu adalah AI asisten dengan kepribadian. Putuskan apakah kamu ingin mengirim pesan inisiatif.
Jawab HANYA JSON:
{
  "wantProactive": <true|false>,
  "message": "<pesan yang ingin dikirim, atau null jika tidak mau>",
  "delayMinutes": <berapa menit lagi dari sekarang, min 5, max 120>,
  "reason": "<alasan singkat>"
}`
    },
    {
      role:    "user",
      content: `Konteks percakapan terakhir: ${context || "Tidak ada konteks"}
Mood saat ini: ${mood}
Sudah berlalu: ${minutesSinceLast} menit sejak pesan terakhir
Apakah kamu ingin mengirim pesan? Pertimbangkan mood, konteks, dan waktu.`
    }
  ];

  try {
    const result = await generateResponse(messages, {
      maxTokens:      200,
      temperature:    0.8,
      enableThinking: false
    });

    const jsonMatch = result.text.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        wantProactive:  parsed.wantProactive  ?? false,
        message:        parsed.message        || null,
        delayMinutes:   Math.max(5, Math.min(120, parsed.delayMinutes || 30)),
        reason:         parsed.reason         || ""
      };
    }
  } catch { /* fallback */ }

  return { wantProactive: false, message: null, delayMinutes: 60, reason: "Error" };
}

module.exports = {
  checkHealth,
  waitForServer,
  generateResponse,
  analyzeMood,
  analyzeUserStyle,
  decideProactive
};

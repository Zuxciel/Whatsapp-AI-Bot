"use strict";

/**
 * modeManager.js
 * ──────────────
 * Orchestrator utama untuk memproses pesan dan menghasilkan respons.
 * - Gabung pesan yang di-buffer (dari debounce)
 * - Kirim ke contextBuilder → aiClient
 * - Update mood setelah respons
 * - Simpan ke database
 */

const { loadConfig }    = require("../config");
const db                = require("../database/db");
const aiClient          = require("./aiClient");
const contextBuilder    = require("./contextBuilder");
const { cleanAiOutput, splitIntoBubbles } = require("../utils/textFilter");

/**
 * Proses pesan dari user dan hasilkan respons AI
 * @param {string} contactId
 * @param {string|string[]} inputMessages - satu pesan atau array (dari buffer)
 * @returns {Promise<{bubbles: string[], rawResponse: string, mood: Object}>}
 */
async function processMessage(contactId, inputMessages) {
  const cfg = loadConfig();

  // Gabungkan array pesan menjadi satu (dari debounce buffer)
  const combinedInput = Array.isArray(inputMessages)
    ? inputMessages.join("\n")
    : inputMessages;

  if (!combinedInput.trim()) {
    return { bubbles: [], rawResponse: "", mood: db.getAiMood(contactId) };
  }

  // Simpan pesan user ke database sebelum generate
  db.addMessage(contactId, "user", combinedInput, {
    source:    "whatsapp",
    buffered:  Array.isArray(inputMessages) && inputMessages.length > 1,
    bufferLen: Array.isArray(inputMessages) ? inputMessages.length : 1
  });

  // Bangun messages array untuk AI
  const messages = await contextBuilder.buildMessages(contactId, combinedInput);

  // Generate respons
  const result = await aiClient.generateResponse(messages, {
    maxTokens:      cfg.model?.maxTokens    ?? 600,
    temperature:    cfg.model?.temperature  ?? 0.75,
    enableThinking: cfg.model?.enableThinking ?? true
  });

  // Clean output (hapus thinking blocks)
  const cleanedResponse = cleanAiOutput(result.text);

  if (!cleanedResponse) {
    const fallback = "Hmm, aku kurang bisa menjawab itu sekarang. Coba tanya lagi ya.";
    db.addMessage(contactId, "assistant", fallback, { isError: true });
    return {
      bubbles:     [fallback],
      rawResponse: fallback,
      mood:        db.getAiMood(contactId)
    };
  }

  // Simpan respons ke database
  const currentMood = db.getAiMood(contactId);
  db.addMessage(contactId, "assistant", cleanedResponse, {
    tokensUsed:      result.tokensUsed,
    inferenceTimeMs: result.inferenceTimeMs,
    aiMoodAtTime:    currentMood.mood,
    hadThinking:     !!result.thinking
  });

  // Update mood secara async (tidak blocking pengiriman)
  updateMoodAsync(contactId, combinedInput, cleanedResponse).catch(() => {});

  // Split ke bubbles
  const bubbles = splitIntoBubbles(cleanedResponse, cfg.bot?.maxBubbleLength ?? 800);

  return {
    bubbles:     bubbles.length > 0 ? bubbles : [cleanedResponse],
    rawResponse: cleanedResponse,
    mood:        currentMood
  };
}

/**
 * Update mood AI secara asinkron setelah respons dikirim
 * Tidak memblokir pengiriman pesan
 */
async function updateMoodAsync(contactId, userMsg, botResponse) {
  try {
    // Kirim ke AI untuk analisis mood
    const texts  = [userMsg, botResponse];
    const analysis = await aiClient.analyzeMood(texts);

    if (analysis?.mood) {
      const prev = db.getAiMood(contactId);

      // Hanya update jika mood berubah signifikan
      const moodChanged = prev.mood !== analysis.mood;
      const isSignificantChange = [
        "angry", "annoyed", "sad", "excited"
      ].includes(analysis.mood);

      if (moodChanged || isSignificantChange) {
        db.updateAiMood(contactId, analysis.mood, analysis.reason);
      }
    }
  } catch { /* silent fail — mood update tidak critical */ }
}

/**
 * Generate pesan proaktif (inisiatif bot)
 * @param {string} contactId
 * @returns {Promise<{bubbles: string[], rawResponse: string}|null>}
 */
async function generateProactiveMessage(contactId) {
  try {
    const cfg     = loadConfig();
    const messages = await contextBuilder.buildProactiveMessages(contactId);

    const result = await aiClient.generateResponse(messages, {
      maxTokens:      200,
      temperature:    0.9,   // lebih kreatif untuk proactive
      enableThinking: false
    });

    const cleaned = cleanAiOutput(result.text);
    if (!cleaned) return null;

    // Simpan ke database
    db.addMessage(contactId, "assistant", cleaned, {
      isProactive:    true,
      tokensUsed:     result.tokensUsed
    });

    const bubbles = splitIntoBubbles(cleaned, cfg.bot?.maxBubbleLength ?? 800);

    return {
      bubbles:     bubbles.length > 0 ? bubbles : [cleaned],
      rawResponse: cleaned
    };
  } catch (err) {
    console.error(`[ModeManager] Gagal generate proactive: ${err.message}`);
    return null;
  }
}

/**
 * Handle command khusus dari user (dimulai dengan !)
 * @param {string} contactId
 * @param {string} command
 * @returns {Promise<string|null>} response text atau null jika bukan command
 */
async function handleCommand(contactId, command) {
  const cfg  = loadConfig();
  const lower = command.toLowerCase().trim();

  // !mode persona / !mode adaptive
  if (lower.startsWith("!mode ")) {
    const newMode = lower.split(" ")[1];
    if (["persona", "adaptive"].includes(newMode)) {
      const { updateConfig } = require("../config");
      updateConfig({ bot: { mode: newMode } });
      return `✅ Mode berganti ke *${newMode}*. Mulai berlaku sekarang.`;
    }
    return `❌ Mode tidak dikenal. Gunakan: !mode persona atau !mode adaptive`;
  }

  // !mood — lihat mood AI saat ini
  if (lower === "!mood") {
    const mood = db.getAiMood(contactId);
    return `😊 Mood AI: *${mood.mood}*\n${mood.reason ? `Alasan: ${mood.reason}` : ""}`;
  }

  // !reset mood
  if (lower === "!resetmood") {
    db.updateAiMood(contactId, "neutral", "Mood direset oleh user");
    return "✅ Mood AI direset ke neutral.";
  }

  // !status
  if (lower === "!status") {
    const mode   = cfg.bot?.mode || "persona";
    const mood   = db.getAiMood(contactId);
    const info   = db.getContactInfo(contactId);
    const msgs   = info.messages?.length || 0;
    return `📊 *Status Bot*\nMode: ${mode}\nMood: ${mood.mood}\nTotal pesan: ${msgs}\nPersona: ${cfg.persona?.name || "Aria"}`;
  }

  // !clear — hapus history
  if (lower === "!clear") {
    const contact = db.loadContact(contactId);
    contact.messages = [];
    db.saveContact(contactId);
    return "🗑️ History percakapan dihapus.";
  }

  // !help
  if (lower === "!help") {
    return `*📖 Daftar Command:*\n\n!mode persona — Ganti ke persona mode\n!mode adaptive — Ganti ke adaptive mirroring\n!mood — Lihat mood AI\n!resetmood — Reset mood ke neutral\n!status — Info lengkap bot\n!clear — Hapus history chat\n!help — Tampilkan ini`;
  }

  return null;
}

module.exports = {
  processMessage,
  generateProactiveMessage,
  handleCommand,
  updateMoodAsync
};

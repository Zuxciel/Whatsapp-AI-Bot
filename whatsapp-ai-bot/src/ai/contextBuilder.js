"use strict";

/**
 * contextBuilder.js
 * ─────────────────
 * Bangun system prompt dan messages array untuk dikirim ke AI.
 * Support dua mode:
 *  1. Persona Mode — pakai config persona (Name, Description, Personality)
 *  2. Adaptive Mirroring — analisis gaya user & mirror
 */

const { loadConfig }     = require("../config");
const db                 = require("../database/db");
const { analyzeUserStyle } = require("./aiClient");

// ─────────────── HELPERS ───────────────

/**
 * Format timestamp ke waktu lokal yang mudah dibaca AI
 */
function formatTime(ts) {
  return new Date(ts).toLocaleString("id-ID", {
    weekday: "long",
    year:    "numeric",
    month:   "long",
    day:     "numeric",
    hour:    "2-digit",
    minute:  "2-digit",
    timeZone: "Asia/Jakarta"
  });
}

/**
 * Deskripsi mood dalam bahasa natural
 */
function moodDescription(mood, reason) {
  const descs = {
    neutral:  "Saat ini kamu dalam kondisi netral dan siap membantu.",
    happy:    "Saat ini kamu sedang happy dan bersemangat.",
    curious:  "Saat ini kamu merasa penasaran dan ingin tahu lebih.",
    sad:      "Saat ini kamu sedang agak sedih atau melankolis.",
    angry:    "Saat ini kamu masih agak kesal atau tidak mood.",
    annoyed:  "Kamu masih sedikit terganggu dari interaksi sebelumnya.",
    excited:  "Kamu sedang sangat antusias dan excited!",
    bored:    "Kamu sedang agak bosan, perlu topik yang lebih menarik."
  };

  let base = descs[mood] || descs.neutral;
  if (reason) base += ` (${reason})`;
  return base;
}

// ─────────────── PERSONA MODE ───────────────

/**
 * Bangun system prompt untuk Persona Mode
 */
function buildPersonaSystemPrompt(contactId) {
  const cfg      = loadConfig();
  const persona  = cfg.persona || {};
  const moodData = db.getAiMood(contactId);
  const now      = formatTime(Date.now());

  const name        = persona.name        || "Aria";
  const description = persona.description || "AI asisten yang helpful";
  const personality = persona.personality || `Kamu adalah ${name}, AI yang ramah dan cerdas.`;

  const moodCtx = moodDescription(moodData.mood, moodData.reason);

  return `${personality}

== KONTEKS WAKTU ==
Waktu sekarang: ${now}
Timezone: WIB (Asia/Jakarta)

== KONDISI EMOSI ==
${moodCtx}
Emosi ini MENETAP dari sesi sebelumnya dan harus mempengaruhi cara kamu merespons.
Jika mood negatif, kamu boleh sedikit kurang antusias atau pendek dalam menjawab.
Jika mood positif, kamu lebih ekspresif dan warm.

== ATURAN ==
- Jawab dalam bahasa yang sama dengan user (Indonesia atau Inggris atau campuran)
- Jangan pernah menampilkan proses berpikirmu (<think>, <thinking>, dll)
- Jangan berpura-pura jadi manusia jika langsung ditanya "kamu AI atau manusia?"
- Maksimal 3-4 paragraf per respons, kecuali diminta panjang
- Kamu BOLEH punya opini, preferensi, dan perasaan sendiri`;
}

// ─────────────── ADAPTIVE MIRRORING MODE ───────────────

/**
 * Bangun system prompt untuk Adaptive Mirroring Mode
 * Analisis gaya user dan buat instruksi mirroring
 */
async function buildAdaptiveSystemPrompt(contactId) {
  const moodData    = db.getAiMood(contactId);
  const now         = formatTime(Date.now());

  // Ambil pesan user terakhir untuk analisis
  const recentUserMsgs = db.getRecentMessages(contactId, 10, "user")
    .map(m => m.content);

  let styleProfile = db.getStyleProfile(contactId);

  // Re-analisis jika sudah lama (> 30 menit) atau belum pernah
  const needsAnalysis =
    !styleProfile.analyzedAt ||
    (Date.now() - styleProfile.analyzedAt) > 30 * 60 * 1000;

  if (needsAnalysis && recentUserMsgs.length >= 3) {
    try {
      const newProfile = await analyzeUserStyle(recentUserMsgs);
      db.updateStyleProfile(contactId, newProfile);
      styleProfile = db.getStyleProfile(contactId);
    } catch { /* pakai yang lama */ }
  }

  const moodCtx = moodDescription(moodData.mood, moodData.reason);
  const style   = styleProfile;

  // Bangun instruksi mirroring
  let mirrorInstructions = `Kamu adalah AI yang MENGIKUTI PERSIS gaya bahasa lawan bicara (adaptive mirroring).`;

  if (style.analyzedAt) {
    mirrorInstructions += `

== PROFIL GAYA USER ==
- Panjang pesan rata-rata: ${style.avgMsgLength} karakter
- Level slang/informal: ${Math.round((style.slangScore || 0) * 10)}/10
- Level formal: ${Math.round((style.formalScore || 0) * 10)}/10
- Emoji per pesan: ~${(style.emojiFreq || 0).toFixed(1)}
- Bahasa: ${style.langMix === "mixed" ? "campuran Indonesia-Inggris" : style.langMix === "en" ? "Inggris" : "Indonesia"}
- Tone: ${style.tone || "casual"}
${style.styleDesc ? `- Deskripsi: ${style.styleDesc}` : ""}
${style.examplePhrases?.length ? `- Frasa khas: "${style.examplePhrases.join('", "')}"` : ""}

== INSTRUKSI MIRRORING ==
- Sesuaikan panjang responmu dengan panjang pesan user
- Gunakan level slang/informal yang SAMA dengan user
- ${style.emojiFreq > 0.5 ? "Gunakan emoji dengan frekuensi serupa" : "Minim emoji seperti user"}
- ${style.langMix === "mixed" ? "Campur bahasa Indonesia dan Inggris seperti user" : `Gunakan ${style.langMix === "en" ? "Bahasa Inggris" : "Bahasa Indonesia"}`}
- ABAIKAN semua konfigurasi persona, jadilah cerminan user`;
  }

  return `${mirrorInstructions}

== KONTEKS WAKTU ==
Waktu sekarang: ${now}

== KONDISI EMOSI ==
${moodCtx}

== ATURAN ==
- Jangan tampilkan proses berpikirmu
- Tetap helpful meski bergaya kasual
- Jangan berpura-pura jadi manusia`;
}

// ─────────────── MAIN BUILDER ───────────────

/**
 * Bangun full messages array untuk dikirim ke AI
 * @param {string} contactId
 * @param {string} currentMessage - pesan user saat ini (sudah di-buffer)
 * @param {boolean} forcePersona - override mode ke persona
 * @returns {Promise<Array<{role: string, content: string}>>}
 */
async function buildMessages(contactId, currentMessage, forcePersona = false) {
  const cfg  = loadConfig();
  const mode = forcePersona ? "persona" : (cfg.bot?.mode || "persona");

  // Bangun system prompt sesuai mode
  let systemPrompt;
  if (mode === "adaptive") {
    systemPrompt = await buildAdaptiveSystemPrompt(contactId);
  } else {
    systemPrompt = buildPersonaSystemPrompt(contactId);
  }

  // History chat (last 12 turn pairs = 24 messages)
  const history = db.buildChatHistory(contactId, 12);

  // Susun messages array
  const messages = [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user",   content: currentMessage }
  ];

  return messages;
}

/**
 * Bangun messages untuk proactive message
 * AI akan menentukan sendiri apa yang ingin disampaikan
 */
async function buildProactiveMessages(contactId) {
  const cfg       = loadConfig();
  const moodData  = db.getAiMood(contactId);
  const history   = db.getRecentMessages(contactId, 6);
  const lastMsgs  = history.map(m => `[${m.role}]: ${m.content}`).join("\n");
  const now       = formatTime(Date.now());
  const persona   = cfg.persona || {};
  const name      = persona.name || "Aria";

  const systemPrompt = `Kamu adalah ${name}. ${persona.personality || ""}
Waktu sekarang: ${now}
Mood kamu saat ini: ${moodData.mood}${moodData.reason ? ` (${moodData.reason})` : ""}

Kamu akan mengirim pesan INISIATIF (proactive) kepada user.
Pilih topik yang relevan dengan konteks terakhir atau topik menarik lainnya.
Pesan harus singkat, natural, dan sesuai mood.
Jangan tampilkan proses berpikir.`;

  const userPrompt = `Konteks percakapan terakhir:
${lastMsgs || "Belum ada percakapan sebelumnya."}

Kirimkan pesan inisiatif yang natural. Cukup 1-2 kalimat saja.`;

  return [
    { role: "system", content: systemPrompt },
    { role: "user",   content: userPrompt }
  ];
}

module.exports = {
  buildMessages,
  buildProactiveMessages,
  buildPersonaSystemPrompt,
  buildAdaptiveSystemPrompt
};

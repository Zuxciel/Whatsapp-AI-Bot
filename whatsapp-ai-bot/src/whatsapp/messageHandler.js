"use strict";

/**
 * messageHandler.js
 * ─────────────────
 * Handler utama untuk semua pesan masuk.
 * Features:
 * - Smart debounce (7 detik anti-spam, buffer pesan bertubi-tubi)
 * - Command handling (!mode, !mood, dll)
 * - Delegate ke modeManager untuk AI response
 * - Kirim response via bubbleDelivery
 * - Reset proactive timer saat ada pesan baru
 */

const { loadConfig }               = require("../config");
const db                           = require("../database/db");
const modeManager                  = require("../ai/modeManager");
const { sendBubbles, showThinking } = require("../utils/bubbleDelivery");
const { resetProactiveForContact } = require("../utils/proactive");
const { validateAndSanitize }      = require("../utils/validator");
const { logChat }                  = require("../utils/logger");

// ──────────────────── DEBOUNCE STATE ────────────────────
// Map: jid → { timer, buffer: string[] }
const _debounceMap = new Map();

// ──────────────────── HELPERS ────────────────────

/**
 * Ekstrak teks dari message object Baileys
 * Support: conversation, extendedText, imageCaption, stickerMessage, dll
 */
function extractText(msg) {
  const m = msg.message;
  if (!m) return null;

  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    m.ephemeralMessage?.message?.conversation ||
    m.ephemeralMessage?.message?.extendedTextMessage?.text ||
    m.viewOnceMessage?.message?.imageMessage?.caption ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.listResponseMessage?.singleSelectReply?.selectedRowId ||
    null
  );
}

// ──────────────────── DEBOUNCE LOGIC ────────────────────

/**
 * Tambah pesan ke buffer debounce untuk JID tertentu.
 * Setelah debounceMs tidak ada pesan baru, proses semua buffer.
 * @param {string} jid
 * @param {string} text
 * @param {Object} sock
 */
function debounceMessage(jid, text, sock) {
  const cfg         = loadConfig();
  const debounceMs  = cfg.bot?.debounceMs ?? 7000;

  // Ambil atau buat state debounce untuk JID ini
  let state = _debounceMap.get(jid);
  if (!state) {
    state = { timer: null, buffer: [] };
    _debounceMap.set(jid, state);
  }

  // Tambah ke buffer
  state.buffer.push(text);

  // Reset timer
  if (state.timer) clearTimeout(state.timer);

  state.timer = setTimeout(async () => {
    // Ambil semua pesan yang terbuffer
    const buffered = [...state.buffer];
    _debounceMap.delete(jid);

    // Proses
    await processBuffered(jid, buffered, sock);
  }, debounceMs);
}

// ──────────────────── PROCESS BUFFERED ────────────────────

/**
 * Proses pesan yang sudah di-buffer setelah debounce
 * @param {string} jid
 * @param {string[]} messages
 * @param {Object} sock
 */
async function processBuffered(jid, messages, sock) {
  if (!messages || messages.length === 0) return;

  // Validasi & sanitasi
  const { valid, sanitized, reason } = validateAndSanitize(messages);
  if (!valid) {
    console.warn(`[Handler] Input invalid dari ${jid}: ${reason}`);
    return;
  }

  // Log
  logChat(jid, "user", sanitized.join(" | "));

  // Reset proactive (user sudah balas)
  resetProactiveForContact(jid);

  // ── Cek command ──
  // Command hanya dari pesan tunggal dan dimulai dengan !
  if (sanitized.length === 1 && sanitized[0].trim().startsWith("!")) {
    const cmdResponse = await modeManager.handleCommand(jid, sanitized[0].trim());
    if (cmdResponse) {
      logChat(jid, "assistant", cmdResponse);
      await sendBubbles(sock, jid, [cmdResponse], false);
      return;
    }
  }

  // ── AI Response ──
  try {
    await showThinking(sock, jid, 1200);

    const result = await modeManager.processMessage(jid, sanitized);

    if (result.bubbles && result.bubbles.length > 0) {
      logChat(jid, "assistant", result.rawResponse, {
        mood:     result.mood?.mood,
        bubbles:  result.bubbles.length,
        ms:       result.inferenceTimeMs
      });
      await sendBubbles(sock, jid, result.bubbles);
    }
  } catch (err) {
    console.error(`[Handler] Error proses pesan dari ${jid}:`, err.message);

    // Kirim error message yang friendly
    const errMsg = err.message?.includes("Inference gagal")
      ? "Maaf, aku lagi ada masalah teknis nih. Coba lagi ya! 🙏"
      : "Hmm, ada yang error. Coba lagi sebentar lagi ya.";

    try {
      await sendBubbles(sock, jid, [errMsg], false);
    } catch { /* ignore delivery error */ }
  }
}

// ──────────────────── MAIN HANDLER ────────────────────

/**
 * Handler utama, di-inject ke client.js
 * @param {Object} msg - Baileys message object
 * @param {Object} sock - Baileys socket
 */
async function onMessage(msg, sock) {
  const jid  = msg.key.remoteJid;
  const text = extractText(msg);

  if (!text || !text.trim()) return;  // Pesan kosong / media tanpa caption

  // Masukkan ke debounce buffer
  debounceMessage(jid, text.trim(), sock);
}

module.exports = { onMessage };

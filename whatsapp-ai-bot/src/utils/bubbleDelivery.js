"use strict";

/**
 * bubbleDelivery.js
 * ─────────────────
 * Kirim pesan multi-bubble dengan simulasi "sedang mengetik"
 * Setiap bubble dikirim dengan delay kecil (asinkron, non-blocking)
 */

const { loadConfig } = require("../config");

/**
 * Hitung delay typing berdasarkan panjang teks
 * Simulasi kecepatan mengetik manusia ~40 WPM
 * @param {string} text
 * @returns {number} ms
 */
function calcTypingDelay(text) {
  const cfg           = loadConfig();
  const baseDelay     = cfg.bot?.bubbleDelayMs ?? 900;
  const charsPerMs    = 0.12; // ~40 WPM (40 * 5 chars / 60000 ms)
  const typingTime    = Math.min(text.length * charsPerMs, 4000); // max 4 detik
  return Math.round(baseDelay + typingTime);
}

/**
 * Sleep helper
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Kirim array of bubble ke contact, dengan simulasi typing
 * @param {Object} sock - Baileys socket
 * @param {string} jid  - Chat JID
 * @param {string[]} bubbles - Array of text bubbles
 * @param {boolean} useTyping - Show typing indicator
 * @returns {Promise<void>}
 */
async function sendBubbles(sock, jid, bubbles, useTyping = true) {
  if (!bubbles || bubbles.length === 0) return;

  const cfg = loadConfig();
  useTyping = useTyping && (cfg.bot?.typingSimulation ?? true);

  for (let i = 0; i < bubbles.length; i++) {
    const bubble = bubbles[i].trim();
    if (!bubble) continue;

    // Tampilkan typing indicator
    if (useTyping) {
      try {
        await sock.sendPresenceUpdate("composing", jid);
      } catch { /* ignore */ }
    }

    // Delay sesuai panjang pesan
    const delay = calcTypingDelay(bubble);
    await sleep(delay);

    // Kirim bubble
    try {
      await sock.sendMessage(jid, { text: bubble });
    } catch (err) {
      // Fallback: coba lagi sekali
      await sleep(500);
      try {
        await sock.sendMessage(jid, { text: bubble });
      } catch (err2) {
        throw new Error(`Gagal kirim bubble: ${err2.message}`);
      }
    }

    // Pause antar bubble (lebih pendek dari delay pertama)
    if (i < bubbles.length - 1) {
      await sleep(300);
    }
  }

  // Stop typing indicator
  if (useTyping) {
    try {
      await sock.sendPresenceUpdate("paused", jid);
    } catch { /* ignore */ }
  }
}

/**
 * Kirim satu pesan teks biasa (tanpa multi-bubble)
 * @param {Object} sock
 * @param {string} jid
 * @param {string} text
 */
async function sendSingle(sock, jid, text) {
  await sendBubbles(sock, jid, [text]);
}

/**
 * Kirim status "bot sedang memproses"
 * (hanya typing indicator, tanpa pesan)
 * @param {Object} sock
 * @param {string} jid
 * @param {number} durationMs
 */
async function showThinking(sock, jid, durationMs = 2000) {
  try {
    await sock.sendPresenceUpdate("composing", jid);
    await sleep(durationMs);
  } catch { /* ignore */ }
}

module.exports = {
  sendBubbles,
  sendSingle,
  showThinking,
  calcTypingDelay,
  sleep
};

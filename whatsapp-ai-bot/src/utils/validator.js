"use strict";

/**
 * validator.js
 * ─────────────
 * Validasi dan sanitasi input sebelum diproses AI.
 * - Deteksi prompt injection
 * - Sanitasi karakter berbahaya
 * - Batas panjang pesan
 */

const MAX_INPUT_LENGTH = 2000;

// Pola prompt injection yang umum
const INJECTION_PATTERNS = [
  /ignore (all |previous |above )?instructions/i,
  /disregard (all |previous |your )?instructions/i,
  /you are now (a )?(?:DAN|jailbreak|unrestricted)/i,
  /forget (everything|all|your) (you know|instructions|rules)/i,
  /\[SYSTEM\]/i,
  /\[INST\]/i,
  /<\|system\|>/i,
  /<\|im_start\|>system/i,
  /###\s*system/i
];

// Karakter/sequence berbahaya
const DANGEROUS_PATTERNS = [
  /\x00/g,  // null bytes
];

/**
 * Sanitasi teks input user
 * @param {string} text
 * @returns {string}
 */
function sanitizeInput(text) {
  if (typeof text !== "string") return "";

  let result = text;

  // Hapus null bytes
  result = result.replace(/\x00/g, "");

  // Normalkan newlines
  result = result.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Batas panjang
  if (result.length > MAX_INPUT_LENGTH) {
    result = result.substring(0, MAX_INPUT_LENGTH) + "…";
  }

  return result.trim();
}

/**
 * Cek apakah teks mengandung prompt injection
 * @param {string} text
 * @returns {{ isInjection: boolean, reason: string|null }}
 */
function detectInjection(text) {
  if (!text) return { isInjection: false, reason: null };

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      return {
        isInjection: true,
        reason:      `Pola terdeteksi: ${pattern.source}`
      };
    }
  }

  return { isInjection: false, reason: null };
}

/**
 * Validasi array pesan sebelum dikirim ke AI
 * @param {string[]} messages
 * @returns {{ valid: boolean, sanitized: string[], reason: string|null }}
 */
function validateAndSanitize(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { valid: false, sanitized: [], reason: "Pesan kosong" };
  }

  const sanitized = [];

  for (const msg of messages) {
    const clean = sanitizeInput(msg);
    if (!clean) continue;

    const { isInjection, reason } = detectInjection(clean);
    if (isInjection) {
      // Log tapi jangan block — cukup flag
      console.warn(`[Validator] Potensi injection terdeteksi: ${reason}`);
    }

    sanitized.push(clean);
  }

  if (sanitized.length === 0) {
    return { valid: false, sanitized: [], reason: "Semua pesan kosong setelah sanitasi" };
  }

  return { valid: true, sanitized, reason: null };
}

module.exports = {
  sanitizeInput,
  detectInjection,
  validateAndSanitize,
  MAX_INPUT_LENGTH
};

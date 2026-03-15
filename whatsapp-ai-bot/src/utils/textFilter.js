"use strict";

/**
 * textFilter.js
 * ─────────────
 * Bersihkan output AI dari tag CoT / thinking sebelum dikirim ke user.
 * Handles: <think>...</think>, <thinking>...</thinking>, [thinking]...[/thinking]
 * Juga normalisasi whitespace dan karakter aneh.
 */

// Pola-pola tag thinking yang perlu dihapus
const THINKING_PATTERNS = [
  // Tag XML standar (greedy=false, case-insensitive, multiline)
  /<think[\s\S]*?<\/think>/gi,
  /<thinking[\s\S]*?<\/thinking>/gi,
  /<reflection[\s\S]*?<\/reflection>/gi,
  /<reasoning[\s\S]*?<\/reasoning>/gi,
  /<internal[\s\S]*?<\/internal>/gi,
  /<scratchpad[\s\S]*?<\/scratchpad>/gi,

  // Bracket style
  /\[think\][\s\S]*?\[\/think\]/gi,
  /\[thinking\][\s\S]*?\[\/thinking\]/gi,
  /\[THINK\][\s\S]*?\[\/THINK\]/gi,

  // Unclosed tags di awal (safety net)
  /^<think>[\s\S]*/gi,
  /^<thinking>[\s\S]*/gi,
];

// Pattern untuk karakter / artefak yang tidak diinginkan
const CLEANUP_PATTERNS = [
  // Zero-width chars
  /[\u200B-\u200D\uFEFF]/g,
  // Multiple blank lines → max 2
  /\n{3,}/g,
  // Trailing whitespace per line
  / +$/gm,
];

/**
 * Hapus semua blok thinking/CoT dari teks
 * @param {string} text
 * @returns {string} cleaned text
 */
function removeThinkingBlocks(text) {
  if (!text || typeof text !== "string") return "";

  let result = text;

  for (const pattern of THINKING_PATTERNS) {
    result = result.replace(pattern, "");
  }

  return result.trim();
}

/**
 * Normalisasi output AI: hapus thinking + bersihkan format
 * @param {string} text
 * @returns {string}
 */
function cleanAiOutput(text) {
  if (!text || typeof text !== "string") return "";

  let result = removeThinkingBlocks(text);

  // Cleanup karakter aneh
  result = result.replace(CLEANUP_PATTERNS[0], ""); // zero-width
  result = result.replace(CLEANUP_PATTERNS[1], "\n\n"); // multiple newlines
  result = result.replace(CLEANUP_PATTERNS[2], ""); // trailing spaces

  // Hapus leading/trailing blank lines
  result = result
    .split("\n")
    .reduce((acc, line, idx, arr) => {
      const isFirst = idx === 0;
      const isLast  = idx === arr.length - 1;
      if ((isFirst || isLast) && !line.trim()) return acc;
      acc.push(line);
      return acc;
    }, [])
    .join("\n");

  return result.trim();
}

/**
 * Pecah teks panjang menjadi array bubble
 * Split berdasarkan \n, gabungkan paragraf pendek
 * @param {string} text
 * @param {number} maxLength - max karakter per bubble
 * @returns {string[]}
 */
function splitIntoBubbles(text, maxLength = 800) {
  if (!text) return [];

  const cleaned = cleanAiOutput(text);
  if (!cleaned) return [];

  // Split berdasarkan newline kosong (paragraf) atau newline biasa
  const paragraphs = cleaned.split(/\n\n+/);
  const bubbles    = [];
  let   current    = "";

  for (const para of paragraphs) {
    const paraClean = para.trim();
    if (!paraClean) continue;

    if (current && (current.length + paraClean.length + 2) > maxLength) {
      bubbles.push(current.trim());
      current = paraClean;
    } else {
      current = current ? `${current}\n\n${paraClean}` : paraClean;
    }
  }

  if (current.trim()) bubbles.push(current.trim());

  // Jika ada bubble yang masih terlalu panjang, split lagi per \n
  const result = [];
  for (const bubble of bubbles) {
    if (bubble.length <= maxLength) {
      result.push(bubble);
    } else {
      const lines = bubble.split("\n");
      let chunk = "";
      for (const line of lines) {
        if (chunk && (chunk.length + line.length + 1) > maxLength) {
          result.push(chunk.trim());
          chunk = line;
        } else {
          chunk = chunk ? `${chunk}\n${line}` : line;
        }
      }
      if (chunk.trim()) result.push(chunk.trim());
    }
  }

  return result.filter(b => b.trim().length > 0);
}

/**
 * Cek apakah teks mengandung blok thinking
 * @param {string} text
 * @returns {boolean}
 */
function hasThinkingBlock(text) {
  if (!text) return false;
  return /<think[\s>]/i.test(text) ||
         /<thinking[\s>]/i.test(text) ||
         /\[think\]/i.test(text);
}

module.exports = {
  removeThinkingBlocks,
  cleanAiOutput,
  splitIntoBubbles,
  hasThinkingBlock
};

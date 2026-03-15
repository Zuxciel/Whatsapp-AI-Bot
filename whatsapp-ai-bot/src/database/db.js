"use strict";

/**
 * db.js — JSON Database Manager
 * ─────────────────────────────
 * Menyimpan per-contact:
 *  - messages (history chat + timestamp + mood per pesan)
 *  - aiMood + aiMoodReason (emotional persistence)
 *  - proactive scheduling data
 *  - style profile (untuk adaptive mirroring)
 *  - statistik interaksi
 *  - persona yang dipakai
 */

const fs   = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { loadConfig }  = require("../config");

// ──────────────────── PATHS ────────────────────
function getDbDir() {
  const cfg = loadConfig();
  const dir = path.join(__dirname, "..", "..", cfg.database.dir || "database");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getContactFile(contactId) {
  const safe = contactId.replace(/[^a-zA-Z0-9@._-]/g, "_");
  return path.join(getDbDir(), `contact_${safe}.json`);
}

function getMetaFile() {
  return path.join(getDbDir(), "_meta.json");
}

// In-memory cache: { contactId => ContactRecord }
const _cache = new Map();

// ──────────────────── DEFAULT SCHEMA ────────────────────
function defaultContact(contactId) {
  const cfg = loadConfig();
  return {
    contactId,
    createdAt:         Date.now(),
    updatedAt:         Date.now(),

    // Persona info
    personaName:        cfg.persona?.name        || "Aria",
    personaPersonality: cfg.persona?.personality || "",
    botMode:            cfg.bot?.mode            || "persona",

    // Emotional state (persistent per contact)
    aiMood:       "neutral",   // neutral | happy | curious | sad | angry | excited | bored
    aiMoodReason: null,
    aiMoodSince:  Date.now(),

    // Messages
    messages: [],

    // Style profile (untuk adaptive mirroring)
    styleProfile: {
      avgMsgLength:   0,
      slangScore:     0,    // 0-1, semakin tinggi semakin banyak slang
      formalScore:    0,    // 0-1
      emojiFreq:      0,    // rata-rata emoji per pesan
      langMix:        "id", // "id" | "en" | "mixed"
      examplePhrases: [],
      analyzedAt:     null
    },

    // Proactive messaging
    proactive: {
      lastProactiveAt:    null,
      proactiveCountToday: 0,
      proactiveCountDate:  null,
      nextProactiveAt:    null,
      aiWantsProactive:   true
    },

    // Stats
    stats: {
      totalUserMessages:  0,
      totalBotMessages:   0,
      firstMessageAt:     null,
      lastMessageAt:      null,
      sessionCount:       0
    },

    // Fine-tuning tracking
    finetuning: {
      lastTrainedAt:   null,
      examplesSinceLastTrain: 0
    }
  };
}

// ──────────────────── LOAD / SAVE ────────────────────
function loadContact(contactId) {
  if (_cache.has(contactId)) return _cache.get(contactId);

  const file = getContactFile(contactId);
  let contact;

  if (fs.existsSync(file)) {
    try {
      const raw = fs.readFileSync(file, "utf-8");
      contact   = JSON.parse(raw);
      // Merge dengan default untuk field baru (backwards compat)
      contact = mergeWithDefault(contact, defaultContact(contactId));
    } catch {
      contact = defaultContact(contactId);
    }
  } else {
    contact = defaultContact(contactId);
  }

  _cache.set(contactId, contact);
  return contact;
}

function saveContact(contactId) {
  const contact = _cache.get(contactId);
  if (!contact) return;

  contact.updatedAt = Date.now();

  const cfg     = loadConfig();
  const maxMsgs = cfg.database?.maxMessagesPerContact ?? 500;

  // Trim messages jika terlalu banyak (keep yang terbaru)
  if (contact.messages.length > maxMsgs) {
    contact.messages = contact.messages.slice(-maxMsgs);
  }

  const file = getContactFile(contactId);
  fs.writeFileSync(file, JSON.stringify(contact, null, 2), "utf-8");
}

function mergeWithDefault(existing, defaults) {
  const result = { ...defaults, ...existing };
  for (const key of Object.keys(defaults)) {
    if (
      defaults[key] !== null &&
      typeof defaults[key] === "object" &&
      !Array.isArray(defaults[key]) &&
      existing[key] !== undefined
    ) {
      result[key] = mergeWithDefault(existing[key] || {}, defaults[key]);
    }
  }
  return result;
}

// ──────────────────── MESSAGE OPS ────────────────────

/**
 * Tambah pesan baru ke history
 * @param {string} contactId
 * @param {"user"|"assistant"} role
 * @param {string} content
 * @param {Object} meta - tambahan metadata (mood, context, dll)
 * @returns {string} message id
 */
function addMessage(contactId, role, content, meta = {}) {
  const contact = loadContact(contactId);
  const now     = Date.now();

  const msg = {
    id:        uuidv4(),
    role,
    content,
    timestamp: now,
    datetime:  new Date(now).toISOString(),

    // Mood AI saat merespons
    aiMoodAtTime:  contact.aiMood,

    // Metadata tambahan
    ...meta
  };

  contact.messages.push(msg);

  // Update stats
  if (role === "user") {
    contact.stats.totalUserMessages++;
    if (!contact.stats.firstMessageAt) contact.stats.firstMessageAt = now;
    contact.stats.lastMessageAt = now;
  } else {
    contact.stats.totalBotMessages++;
  }

  contact.finetuning.examplesSinceLastTrain++;

  saveContact(contactId);
  return msg.id;
}

/**
 * Ambil N pesan terakhir
 * @param {string} contactId
 * @param {number} n
 * @param {string|null} roleFilter - "user"|"assistant"|null (all)
 * @returns {Array}
 */
function getRecentMessages(contactId, n = 20, roleFilter = null) {
  const contact = loadContact(contactId);
  let msgs = contact.messages;
  if (roleFilter) msgs = msgs.filter(m => m.role === roleFilter);
  return msgs.slice(-n);
}

/**
 * Bangun history untuk dikirim ke AI (format messages array)
 * @param {string} contactId
 * @param {number} maxMessages - max turn pairs
 * @returns {Array<{role, content}>}
 */
function buildChatHistory(contactId, maxMessages = 12) {
  const contact = loadContact(contactId);
  const msgs = contact.messages.slice(-maxMessages * 2);

  return msgs.map(m => ({
    role:    m.role,
    content: m.content
  }));
}

// ──────────────────── MOOD OPS ────────────────────

/**
 * Update mood AI untuk contact tertentu
 * @param {string} contactId
 * @param {string} mood
 * @param {string} reason
 */
function updateAiMood(contactId, mood, reason = null) {
  const contact = loadContact(contactId);
  const oldMood = contact.aiMood;

  contact.aiMood       = mood;
  contact.aiMoodReason = reason;
  contact.aiMoodSince  = Date.now();

  saveContact(contactId);

  return { oldMood, newMood: mood };
}

/**
 * Ambil mood AI saat ini untuk contact
 */
function getAiMood(contactId) {
  const contact = loadContact(contactId);
  return {
    mood:   contact.aiMood,
    reason: contact.aiMoodReason,
    since:  contact.aiMoodSince
  };
}

// ──────────────────── STYLE PROFILE ────────────────────

/**
 * Update style profile berdasarkan analisis pesan user
 */
function updateStyleProfile(contactId, profile) {
  const contact = loadContact(contactId);
  contact.styleProfile = {
    ...contact.styleProfile,
    ...profile,
    analyzedAt: Date.now()
  };
  saveContact(contactId);
}

function getStyleProfile(contactId) {
  const contact = loadContact(contactId);
  return contact.styleProfile;
}

// ──────────────────── PROACTIVE OPS ────────────────────

function updateProactive(contactId, patch) {
  const contact = loadContact(contactId);
  contact.proactive = { ...contact.proactive, ...patch };
  saveContact(contactId);
}

function getProactive(contactId) {
  const contact = loadContact(contactId);
  return contact.proactive;
}

/**
 * Cek apakah proactive masih dalam batas hari ini
 */
function canSendProactive(contactId) {
  const cfg     = loadConfig();
  const maxDay  = cfg.proactive?.maxProactivePerDay ?? 5;
  const contact = loadContact(contactId);
  const pro     = contact.proactive;

  if (!pro.aiWantsProactive) return false;

  // Reset counter jika hari baru
  const today = new Date().toDateString();
  if (pro.proactiveCountDate !== today) {
    contact.proactive.proactiveCountToday = 0;
    contact.proactive.proactiveCountDate  = today;
    saveContact(contactId);
    return true;
  }

  return pro.proactiveCountToday < maxDay;
}

// ──────────────────── CONTACT LIST ────────────────────

function getAllContactIds() {
  const dir = getDbDir();
  return fs
    .readdirSync(dir)
    .filter(f => f.startsWith("contact_") && f.endsWith(".json"))
    .map(f => {
      try {
        const raw = fs.readFileSync(path.join(dir, f), "utf-8");
        return JSON.parse(raw).contactId;
      } catch { return null; }
    })
    .filter(Boolean);
}

function getContactInfo(contactId) {
  return loadContact(contactId);
}

// ──────────────────── FINE-TUNING CHECK ────────────────────

function getFinetuningStats() {
  const ids = getAllContactIds();
  let totalExamples = 0;
  for (const id of ids) {
    const c = loadContact(id);
    totalExamples += c.finetuning?.examplesSinceLastTrain || 0;
  }
  return { totalExamples, contactCount: ids.length };
}

function markFinetuningDone() {
  const ids = getAllContactIds();
  const now = Date.now();
  for (const id of ids) {
    const c = loadContact(id);
    c.finetuning.lastTrainedAt           = now;
    c.finetuning.examplesSinceLastTrain  = 0;
    _cache.set(id, c);
    saveContact(id);
  }
}

// ──────────────────── BACKUP ────────────────────

function backupDatabase() {
  const dir    = getDbDir();
  const backupDir = path.join(dir, "backup");
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

  const ts    = new Date().toISOString().replace(/[:.]/g, "-");
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".json") && !f.startsWith("_"));

  for (const file of files) {
    fs.copyFileSync(
      path.join(dir, file),
      path.join(backupDir, `${ts}_${file}`)
    );
  }

  // Keep only last 10 backups per file
  const allBackups = fs.readdirSync(backupDir).sort();
  if (allBackups.length > 50) {
    allBackups.slice(0, allBackups.length - 50).forEach(f =>
      fs.unlinkSync(path.join(backupDir, f))
    );
  }
}

// ──────────────────── SESSION COUNT ────────────────────

function incrementSession(contactId) {
  const contact = loadContact(contactId);
  contact.stats.sessionCount = (contact.stats.sessionCount || 0) + 1;
  saveContact(contactId);
}

module.exports = {
  loadContact,
  saveContact,
  addMessage,
  getRecentMessages,
  buildChatHistory,
  updateAiMood,
  getAiMood,
  updateStyleProfile,
  getStyleProfile,
  updateProactive,
  getProactive,
  canSendProactive,
  getAllContactIds,
  getContactInfo,
  getFinetuningStats,
  markFinetuningDone,
  backupDatabase,
  incrementSession
};

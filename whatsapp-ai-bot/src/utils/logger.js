"use strict";

/**
 * logger.js
 * ─────────
 * Centralized logger berbasis pino dengan:
 * - Output ke console (pretty) + file
 * - Log level dari config
 * - Helper per-modul
 */

const fs   = require("fs");
const path = require("path");
const pino = require("pino");
const { loadConfig } = require("../config");

const LOG_DIR = path.join(__dirname, "..", "..", "logs");
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const cfg       = loadConfig();
const LOG_LEVEL = cfg.logging?.level || "info";

// Buat file stream
const logFile = path.join(LOG_DIR, `bot_${new Date().toISOString().split("T")[0]}.log`);
const fileStream = pino.destination({ dest: logFile, sync: false });

// Multi-stream: console + file
const transport = pino.transport({
  targets: [
    {
      target: "pino-pretty",
      options: {
        colorize:        true,
        translateTime:   "SYS:HH:MM:ss",
        ignore:          "pid,hostname",
        messageFormat:   "[{module}] {msg}",
        levelFirst:      false
      },
      level: LOG_LEVEL
    },
    {
      target: "pino/file",
      options: { destination: logFile },
      level: "debug"
    }
  ]
});

const _root = pino({ level: LOG_LEVEL }, transport);

/**
 * Buat child logger dengan nama modul
 * @param {string} module
 * @returns pino child logger
 */
function createLogger(module) {
  return _root.child({ module });
}

// Shortcut loggers per modul
const loggers = {
  bot:        createLogger("BOT"),
  ai:         createLogger("AI"),
  wa:         createLogger("WA"),
  db:         createLogger("DB"),
  proactive:  createLogger("PROACTIVE"),
  finetune:   createLogger("FINETUNE"),
  handler:    createLogger("HANDLER")
};

/**
 * Log pesan masuk/keluar dengan format standar
 */
function logChat(jid, role, text, extra = {}) {
  const icon    = role === "user" ? "👤" : "🤖";
  const number  = jid.split("@")[0];
  const preview = text.length > 80 ? text.substring(0, 80) + "…" : text;
  loggers.handler.info({ jid, role, ...extra }, `${icon} (${number}): ${preview}`);
}

module.exports = {
  createLogger,
  logChat,
  ...loggers
};

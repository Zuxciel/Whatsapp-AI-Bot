"use strict";

const fs   = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "..", "config.json");

let _config = null;

/**
 * Load dan cache konfigurasi dari config.json
 * @returns {Object} config object
 */
function loadConfig() {
  if (_config) return _config;

  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`config.json tidak ditemukan di: ${CONFIG_PATH}`);
  }

  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    _config = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Gagal parse config.json: ${err.message}`);
  }

  // Set defaults jika tidak ada di config
  _config.bot         = _config.bot         || {};
  _config.persona     = _config.persona     || {};
  _config.inference   = _config.inference   || {};
  _config.model       = _config.model       || {};
  _config.proactive   = _config.proactive   || {};
  _config.finetuning  = _config.finetuning  || {};
  _config.database    = _config.database    || {};
  _config.logging     = _config.logging     || {};

  // Defaults
  _config.bot.debounceMs        = _config.bot.debounceMs        ?? 7000;
  _config.bot.bubbleDelayMs     = _config.bot.bubbleDelayMs     ?? 900;
  _config.bot.maxBubbleLength   = _config.bot.maxBubbleLength   ?? 800;
  _config.bot.mode              = _config.bot.mode              || "persona";
  _config.bot.allowedNumbers    = _config.bot.allowedNumbers    || [];
  _config.bot.blockNumbers      = _config.bot.blockNumbers      || [];
  _config.bot.allowGroupChats   = _config.bot.allowGroupChats   ?? false;
  _config.bot.onlyPrivateChats  = _config.bot.onlyPrivateChats  ?? true;
  _config.bot.typingSimulation  = _config.bot.typingSimulation  ?? true;

  _config.inference.host        = _config.inference.host        || "http://localhost:8000";
  _config.inference.timeout     = _config.inference.timeout     || 120000;
  _config.inference.retryAttempts = _config.inference.retryAttempts ?? 3;

  _config.model.maxTokens       = _config.model.maxTokens       ?? 600;
  _config.model.temperature     = _config.model.temperature     ?? 0.75;
  _config.model.enableThinking  = _config.model.enableThinking  ?? true;

  _config.proactive.enabled           = _config.proactive.enabled           ?? true;
  _config.proactive.minIntervalMinutes = _config.proactive.minIntervalMinutes ?? 5;
  _config.proactive.maxIntervalMinutes = _config.proactive.maxIntervalMinutes ?? 120;
  _config.proactive.maxProactivePerDay = _config.proactive.maxProactivePerDay ?? 5;

  _config.finetuning.enabled              = _config.finetuning.enabled              ?? true;
  _config.finetuning.minExamplesBeforeTrain = _config.finetuning.minExamplesBeforeTrain ?? 30;
  _config.finetuning.checkIntervalHours   = _config.finetuning.checkIntervalHours   ?? 12;

  _config.database.dir                  = _config.database.dir                  || "database";
  _config.database.maxMessagesPerContact = _config.database.maxMessagesPerContact ?? 500;

  return _config;
}

/**
 * Reload config dari disk (useful untuk hot-reload)
 */
function reloadConfig() {
  _config = null;
  return loadConfig();
}

/**
 * Update config di memory dan disk
 * @param {Object} patch - partial config object
 */
function updateConfig(patch) {
  const cfg = loadConfig();
  deepMerge(cfg, patch);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf-8");
  return cfg;
}

function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
      target[key] = target[key] || {};
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

module.exports = { loadConfig, reloadConfig, updateConfig };

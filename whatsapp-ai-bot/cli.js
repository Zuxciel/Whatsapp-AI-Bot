#!/usr/bin/env node
"use strict";

/**
 * cli.js — Admin Command Line Interface
 * ─────────────────────────────────────
 * Tool manajemen bot tanpa harus masuk WhatsApp.
 *
 * Usage:
 *   node cli.js contacts         — Daftar semua kontak
 *   node cli.js mood <jid>       — Lihat/set mood AI untuk kontak
 *   node cli.js history <jid>    — Lihat history chat
 *   node cli.js config           — Tampilkan config
 *   node cli.js config set <key> <val> — Update config
 *   node cli.js finetune         — Jalankan fine-tuning sekarang
 *   node cli.js backup           — Backup database
 *   node cli.js stats            — Statistik bot
 *   node cli.js send <jid> <msg> — Kirim pesan manual (debug)
 *   node cli.js allow <number>   — Tambah nomor ke whitelist
 *   node cli.js block <number>   — Tambah nomor ke blacklist
 *   node cli.js clearhistory <jid> — Hapus history kontak
 */

const path  = require("path");
const fs    = require("fs");
const { execSync } = require("child_process");

// Pastikan working dir benar
process.chdir(path.join(__dirname));

const db     = require("./src/database/db");
const { loadConfig, updateConfig } = require("./src/config");

const args = process.argv.slice(2);
const cmd  = args[0];

// ─── COLOR HELPERS ───────────────────────────────────────
const c = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  green:  "\x1b[32m",
  yellow: "\x1b[33m",
  red:    "\x1b[31m",
  cyan:   "\x1b[36m",
  gray:   "\x1b[90m",
  blue:   "\x1b[34m"
};

function title(t)  { console.log(`\n${c.bold}${c.cyan}${t}${c.reset}`); }
function ok(t)     { console.log(`${c.green}✅ ${t}${c.reset}`); }
function warn(t)   { console.log(`${c.yellow}⚠️  ${t}${c.reset}`); }
function err(t)    { console.log(`${c.red}❌ ${t}${c.reset}`); }
function info(t)   { console.log(`   ${c.gray}${t}${c.reset}`); }
function bold(t)   { return `${c.bold}${t}${c.reset}`; }
function sep()     { console.log(c.gray + "─".repeat(60) + c.reset); }

// ─── COMMANDS ──────────────────────────────────────────────

function cmdContacts() {
  title("📋 Daftar Kontak");
  sep();

  const ids = db.getAllContactIds();
  if (ids.length === 0) {
    warn("Belum ada kontak terdaftar.");
    return;
  }

  for (const id of ids) {
    const contact = db.getContactInfo(id);
    const msgs    = contact.messages?.length || 0;
    const mood    = contact.aiMood || "neutral";
    const last    = contact.stats?.lastMessageAt
      ? new Date(contact.stats.lastMessageAt).toLocaleString("id-ID")
      : "Belum ada";

    console.log(`\n${bold(id)}`);
    info(`Pesan: ${msgs} | Mood AI: ${mood} | Terakhir: ${last}`);
    info(`Total user msg: ${contact.stats?.totalUserMessages || 0} | Bot msg: ${contact.stats?.totalBotMessages || 0}`);
  }
  sep();
  console.log(`Total: ${ids.length} kontak\n`);
}

function cmdMood(jid, newMood) {
  if (!jid) { err("Usage: node cli.js mood <jid> [newmood]"); return; }

  if (newMood) {
    const valid = ["neutral","happy","curious","sad","angry","annoyed","excited","bored"];
    if (!valid.includes(newMood)) {
      err(`Mood tidak valid. Pilih: ${valid.join(", ")}`);
      return;
    }
    db.updateAiMood(jid, newMood, "Di-set manual via CLI");
    ok(`Mood AI untuk ${jid} diubah ke ${bold(newMood)}`);
  } else {
    const mood = db.getAiMood(jid);
    title(`😊 Mood AI untuk ${jid}`);
    info(`Mood    : ${bold(mood.mood)}`);
    info(`Alasan  : ${mood.reason || "-"}`);
    info(`Sejak   : ${mood.since ? new Date(mood.since).toLocaleString("id-ID") : "-"}`);
  }
}

function cmdHistory(jid, limit = 20) {
  if (!jid) { err("Usage: node cli.js history <jid> [limit]"); return; }

  title(`💬 History Chat: ${jid}`);
  sep();

  const msgs = db.getRecentMessages(jid, parseInt(limit));
  if (msgs.length === 0) {
    warn("Belum ada history.");
    return;
  }

  for (const m of msgs) {
    const time    = new Date(m.timestamp).toLocaleTimeString("id-ID");
    const role    = m.role === "user" ? `${c.blue}👤 User${c.reset}` : `${c.green}🤖 Bot${c.reset}`;
    const mood    = m.aiMoodAtTime ? ` [mood:${m.aiMoodAtTime}]` : "";
    const preview = m.content.length > 100
      ? m.content.substring(0, 100) + "…"
      : m.content;

    console.log(`${c.gray}[${time}]${c.reset} ${role}${c.gray}${mood}${c.reset}`);
    console.log(`   ${preview}`);
  }
  sep();
  console.log(`Menampilkan ${msgs.length} pesan terakhir.\n`);
}

function cmdConfig(subArgs) {
  if (subArgs[0] === "set") {
    const key = subArgs[1];
    const val = subArgs[2];
    if (!key || !val) {
      err("Usage: node cli.js config set <dot.key> <value>");
      info("Contoh: node cli.js config set bot.mode adaptive");
      return;
    }

    // Parse nested key (e.g., "bot.mode")
    const keys   = key.split(".");
    const patch  = {};
    let   cursor = patch;
    for (let i = 0; i < keys.length - 1; i++) {
      cursor[keys[i]] = {};
      cursor = cursor[keys[i]];
    }

    // Auto-parse value
    let parsedVal = val;
    if (val === "true")  parsedVal = true;
    if (val === "false") parsedVal = false;
    if (!isNaN(val))     parsedVal = Number(val);

    cursor[keys[keys.length - 1]] = parsedVal;
    updateConfig(patch);
    ok(`Config ${bold(key)} diubah ke ${bold(String(parsedVal))}`);

  } else {
    title("⚙️  Konfigurasi Bot");
    sep();
    const cfg = loadConfig();
    console.log(JSON.stringify(cfg, null, 2));
  }
}

async function cmdFinetune() {
  title("🎓 Menjalankan Fine-tuning");
  const stats = db.getFinetuningStats();
  info(`Training examples tersedia: ${stats.totalExamples}`);

  if (stats.totalExamples < 5) {
    warn("Data terlalu sedikit untuk fine-tuning (<5 examples).");
    warn("Jalankan dengan --force: node cli.js finetune --force");
    if (!args.includes("--force")) return;
  }

  const force = args.includes("--force") ? ["--force"] : [];
  console.log("\nMenjalankan: python finetune.py " + force.join(" "));

  try {
    execSync(`python finetune.py ${force.join(" ")}`, {
      stdio: "inherit",
      cwd:   __dirname
    });
    ok("Fine-tuning selesai!");
  } catch {
    err("Fine-tuning gagal. Lihat output di atas.");
  }
}

function cmdBackup() {
  title("💾 Backup Database");
  try {
    db.backupDatabase();
    ok("Backup berhasil!");
    info(`Lokasi: database/backup/`);
  } catch (e) {
    err(`Backup gagal: ${e.message}`);
  }
}

function cmdStats() {
  title("📊 Statistik Bot");
  sep();

  const ids   = db.getAllContactIds();
  const ftStats = db.getFinetuningStats();

  let totalUser = 0, totalBot = 0;
  const moodCounts = {};

  for (const id of ids) {
    const c = db.getContactInfo(id);
    totalUser += c.stats?.totalUserMessages || 0;
    totalBot  += c.stats?.totalBotMessages  || 0;
    const mood = c.aiMood || "neutral";
    moodCounts[mood] = (moodCounts[mood] || 0) + 1;
  }

  info(`Total kontak       : ${bold(String(ids.length))}`);
  info(`Total pesan user   : ${bold(String(totalUser))}`);
  info(`Total pesan bot    : ${bold(String(totalBot))}`);
  info(`Training examples  : ${bold(String(ftStats.totalExamples))}`);
  info(`Distribusi mood AI :`);
  for (const [mood, count] of Object.entries(moodCounts)) {
    info(`  ${mood.padEnd(12)}: ${"█".repeat(count)} (${count})`);
  }

  const cfg = loadConfig();
  sep();
  info(`Mode aktif  : ${bold(cfg.bot?.mode || "persona")}`);
  info(`Persona     : ${bold(cfg.persona?.name || "Aria")}`);
  info(`Proactive   : ${bold(cfg.proactive?.enabled ? "Aktif" : "Nonaktif")}`);
  info(`Fine-tuning : ${bold(cfg.finetuning?.enabled ? "Aktif" : "Nonaktif")}`);
  console.log();
}

function cmdAllow(number) {
  if (!number) { err("Usage: node cli.js allow <number>"); return; }
  number = number.replace(/\D/g, "");

  const cfg     = loadConfig();
  const allowed = cfg.bot?.allowedNumbers || [];
  if (!allowed.includes(number)) {
    allowed.push(number);
    updateConfig({ bot: { allowedNumbers: allowed } });
    ok(`${number} ditambahkan ke whitelist.`);
  } else {
    warn(`${number} sudah ada di whitelist.`);
  }
}

function cmdBlock(number) {
  if (!number) { err("Usage: node cli.js block <number>"); return; }
  number = number.replace(/\D/g, "");

  const cfg     = loadConfig();
  const blocked = cfg.bot?.blockNumbers || [];
  if (!blocked.includes(number)) {
    blocked.push(number);
    updateConfig({ bot: { blockNumbers: blocked } });
    ok(`${number} ditambahkan ke blacklist.`);
  } else {
    warn(`${number} sudah ada di blacklist.`);
  }
}

function cmdClearHistory(jid) {
  if (!jid) { err("Usage: node cli.js clearhistory <jid>"); return; }
  const contact = db.loadContact(jid);
  const count   = contact.messages?.length || 0;
  contact.messages = [];
  db.saveContact(jid);
  ok(`History untuk ${jid} dihapus (${count} pesan dihapus).`);
}

function cmdHelp() {
  title("📖 WhatsApp AI Bot — Admin CLI");
  sep();
  const cmds = [
    ["contacts",              "Daftar semua kontak"],
    ["mood <jid> [mood]",     "Lihat/set mood AI untuk kontak"],
    ["history <jid> [limit]", "Lihat history chat (default: 20)"],
    ["config",                "Tampilkan konfigurasi"],
    ["config set <key> <v>",  "Update config (pakai dot notation)"],
    ["finetune [--force]",    "Jalankan fine-tuning sekarang"],
    ["backup",                "Backup database"],
    ["stats",                 "Statistik global bot"],
    ["allow <number>",        "Tambah nomor ke whitelist"],
    ["block <number>",        "Tambah nomor ke blacklist"],
    ["clearhistory <jid>",    "Hapus history percakapan kontak"],
    ["help",                  "Tampilkan bantuan ini"],
  ];
  for (const [c, d] of cmds) {
    console.log(`  ${c.bold ? "" : ""}${bold("node cli.js " + c.padEnd(28))}${c.gray || ""}${d}${c.reset || ""}`);
  }
  console.log();
}

// ─── ROUTER ──────────────────────────────────────────────
(async () => {
  switch (cmd) {
    case "contacts":     cmdContacts(); break;
    case "mood":         cmdMood(args[1], args[2]); break;
    case "history":      cmdHistory(args[1], args[2]); break;
    case "config":       cmdConfig(args.slice(1)); break;
    case "finetune":     await cmdFinetune(); break;
    case "backup":       cmdBackup(); break;
    case "stats":        cmdStats(); break;
    case "allow":        cmdAllow(args[1]); break;
    case "block":        cmdBlock(args[1]); break;
    case "clearhistory": cmdClearHistory(args[1]); break;
    case "help":
    case undefined:      cmdHelp(); break;
    default:
      err(`Command tidak dikenal: ${cmd}`);
      cmdHelp();
  }
})();

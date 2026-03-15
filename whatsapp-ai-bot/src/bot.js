"use strict";

/**
 * bot.js — Entry Point Utama
 * ─────────────────────────
 * Urutan startup:
 *  1. Load & validasi config
 *  2. Tunggu inference server siap (dengan polling)
 *  3. Connect WhatsApp (dengan persistent session)
 *  4. Mulai proactive scheduler
 *  5. Mulai fine-tuning checker
 *  6. Mulai database backup scheduler
 */

const path   = require("path");
const cron   = require("node-cron");
const { loadConfig }           = require("./config");
const { waitForServer }        = require("./ai/aiClient");
const waClient                 = require("./whatsapp/client");
const { onMessage }            = require("./whatsapp/messageHandler");
const proactive                = require("./utils/proactive");
const db                       = require("./database/db");

// ──────────────────── BANNER ────────────────────
function printBanner() {
  console.log("\n" + "=".repeat(60));
  console.log("  🤖  WhatsApp AI Bot — Powered by Qwen3-1.7B (Local)");
  console.log("=".repeat(60));
  const cfg = loadConfig();
  console.log(`  Mode      : ${cfg.bot?.mode || "persona"}`);
  console.log(`  Persona   : ${cfg.persona?.name || "Aria"}`);
  console.log(`  Debounce  : ${cfg.bot?.debounceMs || 7000}ms`);
  console.log(`  Proactive : ${cfg.proactive?.enabled ? "Aktif" : "Nonaktif"}`);
  console.log(`  FineTune  : ${cfg.finetuning?.enabled ? "Aktif" : "Nonaktif"}`);
  console.log("=".repeat(60) + "\n");
}

// ──────────────────── FINE-TUNING CHECKER ────────────────────
function startFinetuneChecker() {
  const cfg = loadConfig();
  if (!cfg.finetuning?.enabled) return;

  const intervalHours = cfg.finetuning?.checkIntervalHours ?? 12;
  const minExamples   = cfg.finetuning?.minExamplesBeforeTrain ?? 30;

  // Jalankan setiap N jam
  const cronExpr = `0 */${intervalHours} * * *`;

  cron.schedule(cronExpr, async () => {
    const stats = db.getFinetuningStats();
    console.log(`[FineTune] 📊 Examples sejak training terakhir: ${stats.totalExamples}`);

    if (stats.totalExamples >= minExamples) {
      console.log(`[FineTune] 🚀 Memulai fine-tuning (${stats.totalExamples} examples)...`);
      await runFinetuning();
    } else {
      console.log(`[FineTune] ⏳ Belum cukup (${stats.totalExamples}/${minExamples}). Skip.`);
    }
  });

  console.log(`[FineTune] ⏰ Checker aktif, cek setiap ${intervalHours} jam.`);
}

async function runFinetuning() {
  const { spawn } = require("child_process");
  const scriptPath = path.join(__dirname, "..", "finetune.py");

  return new Promise((resolve) => {
    const proc = spawn("python", [scriptPath], {
      stdio:    "inherit",
      cwd:      path.join(__dirname, ".."),
      detached: false
    });

    proc.on("close", (code) => {
      if (code === 0) {
        console.log("[FineTune] ✅ Fine-tuning selesai!");
        db.markFinetuningDone();
      } else {
        console.error(`[FineTune] ❌ Fine-tuning gagal (exit code: ${code})`);
      }
      resolve();
    });

    proc.on("error", (err) => {
      console.error(`[FineTune] ❌ Error spawn: ${err.message}`);
      resolve();
    });
  });
}

// ──────────────────── DATABASE BACKUP ────────────────────
function startBackupScheduler() {
  const cfg = loadConfig();
  if (!cfg.database?.backupEnabled) return;

  const intervalHours = cfg.database?.backupIntervalHours ?? 6;
  const cronExpr = `0 */${intervalHours} * * *`;

  cron.schedule(cronExpr, () => {
    try {
      db.backupDatabase();
      console.log("[Backup] 💾 Database backup selesai.");
    } catch (err) {
      console.error("[Backup] ❌ Backup gagal:", err.message);
    }
  });

  console.log(`[Backup] ⏰ Scheduler aktif, backup setiap ${intervalHours} jam.`);
}

// ──────────────────── GRACEFUL SHUTDOWN ────────────────────
function setupShutdownHandlers() {
  const shutdown = (signal) => {
    console.log(`\n[Bot] 🛑 Menerima ${signal}, shutdown...`);
    proactive.stopScheduler();

    // Backup database sebelum exit
    try {
      db.backupDatabase();
      console.log("[Bot] 💾 Final backup selesai.");
    } catch { /* ignore */ }

    console.log("[Bot] 👋 Bye!");
    process.exit(0);
  };

  process.on("SIGINT",  () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  process.on("uncaughtException", (err) => {
    console.error("[Bot] ❌ Uncaught Exception:", err.message);
    console.error(err.stack);
  });

  process.on("unhandledRejection", (reason) => {
    console.error("[Bot] ❌ Unhandled Rejection:", reason);
  });
}

// ──────────────────── MAIN ────────────────────
async function main() {
  printBanner();
  setupShutdownHandlers();

  // 1. Tunggu inference server
  console.log("[Bot] 🔍 Mengecek inference server...");
  console.log("[Bot] Pastikan sudah menjalankan: python inference_server.py");
  const serverReady = await waitForServer(300000, 5000); // wait max 5 menit
  if (!serverReady) {
    console.error("[Bot] ❌ Inference server tidak merespons. Pastikan sudah running.");
    process.exit(1);
  }

  // 2. Connect WhatsApp
  console.log("[Bot] 📱 Menghubungkan ke WhatsApp...");
  waClient.setMessageHandler(onMessage);
  const sock = await waClient.connect();

  // 3. Mulai proactive scheduler
  proactive.setSocket(sock);
  proactive.startScheduler();

  // 4. Fine-tuning checker
  startFinetuneChecker();

  // 5. Database backup scheduler
  startBackupScheduler();

  console.log("[Bot] 🎉 Semua sistem aktif! Bot siap beroperasi.");
}

main().catch((err) => {
  console.error("[Bot] ❌ Fatal error:", err.message);
  console.error(err.stack);
  process.exit(1);
});

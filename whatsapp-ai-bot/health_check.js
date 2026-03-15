#!/usr/bin/env node
"use strict";

/**
 * health_check.js
 * ───────────────
 * Cek semua komponen bot apakah berjalan dengan benar.
 * Jalankan: node health_check.js
 */

const path  = require("path");
const fs    = require("fs");
const https = require("http");

process.chdir(path.join(__dirname));

const c = {
  green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m",
  cyan:  "\x1b[36m", gray: "\x1b[90m", bold: "\x1b[1m", reset: "\x1b[0m"
};

const ok   = (t) => console.log(`  ${c.green}✅ ${t}${c.reset}`);
const fail = (t) => console.log(`  ${c.red}❌ ${t}${c.reset}`);
const warn = (t) => console.log(`  ${c.yellow}⚠️  ${t}${c.reset}`);
const info = (t) => console.log(`  ${c.gray}ℹ️  ${t}${c.reset}`);

console.log(`\n${c.bold}${c.cyan}╔══════════════════════════════════════════╗`);
console.log(`║      WhatsApp AI Bot — Health Check     ║`);
console.log(`╚══════════════════════════════════════════╝${c.reset}\n`);

let passed = 0, failed = 0;

// ─── 1. Node.js version ──────────────────────────────
console.log(`${c.bold}[1] Node.js${c.reset}`);
const nodeVer = process.version;
const [major] = nodeVer.slice(1).split(".").map(Number);
if (major >= 18) {
  ok(`Node.js ${nodeVer} (OK)`); passed++;
} else {
  fail(`Node.js ${nodeVer} — diperlukan >= 18`); failed++;
}

// ─── 2. Config ───────────────────────────────────────
console.log(`\n${c.bold}[2] Config${c.reset}`);
try {
  const cfg = require("./src/config").loadConfig();
  ok(`config.json OK (mode: ${cfg.bot?.mode})`); passed++;
  info(`Persona: ${cfg.persona?.name} | Debounce: ${cfg.bot?.debounceMs}ms`);
} catch (e) {
  fail(`config.json error: ${e.message}`); failed++;
}

// ─── 3. Direktori penting ────────────────────────────
console.log(`\n${c.bold}[3] Direktori${c.reset}`);
const dirs = [
  ["auth_info",     "Session WhatsApp"],
  ["database",      "Database JSON"],
  ["logs",          "Log files"],
  ["Models/Qwen",   "Model AI"]
];
for (const [dir, desc] of dirs) {
  if (fs.existsSync(dir)) {
    ok(`${dir}/ (${desc})`); passed++;
  } else {
    warn(`${dir}/ tidak ditemukan — akan dibuat otomatis`);
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ─── 4. Model download marker ────────────────────────
console.log(`\n${c.bold}[4] Model Qwen3-1.7B${c.reset}`);
const marker = path.join("Models", "Qwen", ".downloaded");
if (fs.existsSync(marker)) {
  ok("Model sudah terdownload"); passed++;

  // Cek file-file penting model
  const modelFiles = ["config.json", "tokenizer_config.json"];
  for (const f of modelFiles) {
    const fp = path.join("Models", "Qwen", f);
    if (fs.existsSync(fp)) {
      ok(`  ${f}`);
    } else {
      warn(`  ${f} tidak ditemukan`);
    }
  }

  // Cek adapter
  const adapterPath = path.join("Models", "Qwen", "adapter", "adapter_config.json");
  if (fs.existsSync(adapterPath)) {
    ok("LoRA adapter tersedia"); passed++;
  } else {
    info("LoRA adapter belum ada (akan dibuat setelah fine-tuning)");
  }
} else {
  warn("Model belum didownload — akan didownload saat inference_server.py pertama kali dijalankan");
}

// ─── 5. Node modules ─────────────────────────────────
console.log(`\n${c.bold}[5] Node.js Dependencies${c.reset}`);
const deps = ["@whiskeysockets/baileys", "axios", "pino", "node-cron", "uuid"];
let depsFail = 0;
for (const dep of deps) {
  try {
    require.resolve(dep);
    ok(dep);
  } catch {
    fail(`${dep} — jalankan: npm install`);
    depsFail++; failed++;
  }
}
if (depsFail === 0) passed++;

// ─── 6. Python & packages ────────────────────────────
console.log(`\n${c.bold}[6] Python${c.reset}`);
const { execSync } = require("child_process");

try {
  const pyVer = execSync("python --version 2>&1 || python3 --version 2>&1").toString().trim();
  ok(pyVer); passed++;
} catch {
  fail("Python tidak ditemukan"); failed++;
}

const pyPkgs = ["fastapi", "uvicorn", "torch", "transformers", "peft"];
for (const pkg of pyPkgs) {
  try {
    execSync(`python -c "import ${pkg}" 2>&1`, { stdio: "pipe" });
    ok(pkg);
  } catch {
    try {
      execSync(`python3 -c "import ${pkg}" 2>&1`, { stdio: "pipe" });
      ok(pkg);
    } catch {
      warn(`${pkg} belum terinstall — jalankan: pip install -r requirements.txt`);
    }
  }
}

// ─── 7. Inference server ─────────────────────────────
console.log(`\n${c.bold}[7] Inference Server${c.reset}`);
const cfgForPort = (() => {
  try { return require("./src/config").loadConfig(); } catch { return {}; }
})();
const host = cfgForPort.inference?.host || "http://localhost:8000";
const url  = new URL(host);

const req = https.request({
  hostname: url.hostname,
  port:     url.port || 8000,
  path:     "/health",
  method:   "GET"
}, (res) => {
  let body = "";
  res.on("data", d => body += d);
  res.on("end", () => {
    try {
      const data = JSON.parse(body);
      if (data.status === "ok" && data.model_loaded) {
        ok(`Inference server berjalan (device: ${data.device}, adapter: ${data.adapter_loaded ? "Ya" : "Tidak"})`);
        passed++;
      } else {
        warn(`Inference server berjalan tapi model masih loading...`);
      }
    } catch {
      warn("Inference server merespons tapi output tidak valid");
    }
    printSummary();
  });
});

req.on("error", () => {
  fail("Inference server tidak berjalan — jalankan: python inference_server.py");
  failed++;
  printSummary();
});

req.setTimeout(3000, () => {
  req.destroy();
  fail("Inference server timeout");
  failed++;
  printSummary();
});

req.end();

// ─── 8. WhatsApp session ─────────────────────────────
console.log(`\n${c.bold}[8] WhatsApp Session${c.reset}`);
const authDir = "auth_info";
if (fs.existsSync(authDir)) {
  const files = fs.readdirSync(authDir).filter(f => f.endsWith(".json"));
  if (files.length > 0) {
    ok(`Session ditemukan (${files.length} file)`);
  } else {
    warn("Belum ada session — bot akan minta scan QR saat pertama kali dijalankan");
  }
} else {
  warn("Folder auth_info belum ada");
}

// ─── SUMMARY ─────────────────────────────────────────
function printSummary() {
  console.log(`\n${c.bold}${"─".repeat(44)}${c.reset}`);
  const total = passed + failed;
  if (failed === 0) {
    console.log(`${c.green}${c.bold}🎉 Semua check passed! Bot siap dijalankan.${c.reset}`);
    console.log(`   Jalankan: ${c.cyan}./start.sh${c.reset} (Linux/Mac) atau ${c.cyan}start.bat${c.reset} (Windows)\n`);
  } else {
    console.log(`${c.yellow}${c.bold}⚠️  ${passed}/${total} check passed. Ada ${failed} masalah.${c.reset}`);
    console.log(`   Perbaiki masalah di atas sebelum menjalankan bot.\n`);
  }
}

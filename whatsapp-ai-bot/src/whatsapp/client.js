"use strict";

/**
 * client.js
 * ─────────
 * Setup Baileys WhatsApp client dengan:
 * - useMultiFileAuthState untuk persistent session (no re-scan QR)
 * - Auto reconnect
 * - QR code display di terminal
 */

const path    = require("path");
const pino    = require("pino");
const qrcode  = require("qrcode-terminal");

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  isJidBroadcast,
  isJidGroup
} = require("@whiskeysockets/baileys");

const { loadConfig } = require("../config");

// ──────────────────── STATE ────────────────────
let _sock           = null;
let _messageHandler = null;   // injected dari luar
let _retryCount     = 0;
const MAX_RETRIES   = 10;
const RETRY_DELAY   = 3000;

const AUTH_DIR = path.join(__dirname, "..", "..", "auth_info");

// ──────────────────── LOGGER ────────────────────
const logger = pino({
  level:     "silent",  // silent untuk mengurangi noise Baileys
  transport: undefined
});

// ──────────────────── UTILS ────────────────────
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Cek apakah JID adalah private chat (bukan grup, bukan broadcast)
 * @param {string} jid
 * @returns {boolean}
 */
function isPrivateChat(jid) {
  return !jid.endsWith("@g.us") &&
         !jid.endsWith("@broadcast") &&
         !isJidBroadcast(jid) &&
         jid.endsWith("@s.whatsapp.net");
}

/**
 * Ekstrak nomor telepon dari JID
 * @param {string} jid
 * @returns {string}
 */
function extractNumber(jid) {
  return jid.split("@")[0];
}

/**
 * Cek apakah nomor diizinkan berdasarkan config
 * @param {string} jid
 * @returns {boolean}
 */
function isAllowed(jid) {
  const cfg = loadConfig();

  // Cek blacklist dulu
  const blocked = cfg.bot?.blockNumbers || [];
  const number  = extractNumber(jid);
  if (blocked.includes(number) || blocked.includes(jid)) return false;

  // Cek whitelist
  const allowed = cfg.bot?.allowedNumbers || [];
  if (allowed.length === 0) return true;  // empty = semua boleh

  return allowed.includes(number) || allowed.includes(jid);
}

// ──────────────────── MAIN CONNECTION ────────────────────
async function connect() {
  const cfg = loadConfig();

  // Load / create auth state
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  // Fetch versi Baileys terbaru
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(`[WA] Baileys v${version.join(".")} ${isLatest ? "(latest)" : "(ada versi baru)"}`);

  // Buat socket
  _sock = makeWASocket({
    version,
    logger,
    auth: {
      creds: state.creds,
      keys:  makeCacheableSignalKeyStore(state.keys, logger)
    },
    printQRInTerminal:  false,  // kita handle manual
    browser:            ["WhatsApp AI Bot", "Chrome", "126.0"],
    markOnlineOnConnect: true,
    syncFullHistory:     false,
    generateHighQualityLinkPreview: false,
    getMessage: async (key) => {
      // Tidak perlu store pesan untuk bot sederhana
      return { conversation: "" };
    }
  });

  // ── Event: creds update ──
  _sock.ev.on("creds.update", saveCreds);

  // ── Event: connection update ──
  _sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\n[WA] 📱 Scan QR Code ini untuk login:\n");
      qrcode.generate(qr, { small: true });
      console.log("\n[WA] Atau buka WhatsApp → Linked Devices → Link a Device\n");
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const reason     = DisconnectReason[statusCode] || statusCode;

      console.log(`[WA] 🔌 Koneksi terputus. Reason: ${reason} (${statusCode})`);

      // Logout permanen — jangan reconnect
      if (statusCode === DisconnectReason.loggedOut) {
        console.log("[WA] ❌ Session di-logout. Hapus folder auth_info/ dan restart.");
        process.exit(1);
      }

      // Reconnect jika bukan logout
      if (_retryCount < MAX_RETRIES) {
        _retryCount++;
        const delay = RETRY_DELAY * _retryCount;
        console.log(`[WA] 🔄 Reconnect attempt ${_retryCount}/${MAX_RETRIES} dalam ${delay}ms...`);
        await sleep(delay);
        await connect();
      } else {
        console.error("[WA] ❌ Max retry tercapai. Restart manual diperlukan.");
        process.exit(1);
      }
    }

    if (connection === "open") {
      _retryCount = 0;
      const name = _sock.user?.name || _sock.user?.id || "Unknown";
      console.log(`\n[WA] ✅ Terhubung sebagai: ${name}`);
      console.log(`[WA] Bot aktif dan siap menerima pesan!\n`);
    }
  });

  // ── Event: messages ──
  _sock.ev.on("messages.upsert", async ({ messages: msgs, type }) => {
    if (type !== "notify") return;

    for (const msg of msgs) {
      try {
        await handleIncomingMessage(msg);
      } catch (err) {
        console.error("[WA] Error handling pesan:", err.message);
      }
    }
  });

  return _sock;
}

// ──────────────────── MESSAGE ROUTING ────────────────────
async function handleIncomingMessage(msg) {
  if (!msg.message) return;       // Kosong
  if (msg.key.fromMe) return;     // Dari diri sendiri

  const cfg    = loadConfig();
  const jid    = msg.key.remoteJid;
  const isGroup = jid?.endsWith("@g.us");

  // Filter grup
  if (isGroup && !cfg.bot?.allowGroupChats) return;

  // Filter hanya private chat
  if (cfg.bot?.onlyPrivateChats && !isPrivateChat(jid)) return;

  // Filter whitelist/blacklist
  if (!isAllowed(jid)) return;

  // Delegate ke message handler
  if (_messageHandler) {
    await _messageHandler(msg, _sock);
  }
}

// ──────────────────── PUBLIC API ────────────────────

/**
 * Set message handler (injected dari messageHandler.js)
 * @param {Function} handler - async (msg, sock) => void
 */
function setMessageHandler(handler) {
  _messageHandler = handler;
}

/**
 * Get current socket
 * @returns {Object|null}
 */
function getSocket() {
  return _sock;
}

/**
 * Kirim pesan ke JID tertentu
 * @param {string} jid
 * @param {string} text
 */
async function sendMessage(jid, text) {
  if (!_sock) throw new Error("Socket belum siap");
  return _sock.sendMessage(jid, { text });
}

module.exports = {
  connect,
  setMessageHandler,
  getSocket,
  sendMessage,
  isPrivateChat,
  extractNumber,
  isAllowed
};

"use strict";

/**
 * proactive.js
 * ─────────────
 * Scheduler untuk proactive messaging.
 * AI memutuskan sendiri kapan dan apakah ingin kirim pesan inisiatif.
 * Cek setiap menit, tapi eksekusi hanya jika sudah waktunya.
 */

const { loadConfig }             = require("../config");
const db                         = require("../database/db");
const { decideProactive }        = require("../ai/aiClient");
const { generateProactiveMessage } = require("../ai/modeManager");
const { sendBubbles }            = require("./bubbleDelivery");

let _sock = null;        // Baileys socket (di-set dari luar)
let _isRunning = false;
let _intervalId = null;

/**
 * Set Baileys socket untuk digunakan saat kirim proactive
 */
function setSocket(sock) {
  _sock = sock;
}

/**
 * Jadwalkan proactive untuk contact tertentu
 * @param {string} contactId
 */
async function scheduleProactiveForContact(contactId) {
  if (!_sock) return;

  const cfg = loadConfig();
  if (!cfg.proactive?.enabled) return;

  const contact = db.getContactInfo(contactId);
  const lastMsg = contact.stats?.lastMessageAt;
  if (!lastMsg) return;

  const minutesSinceLast = Math.floor((Date.now() - lastMsg) / 60000);
  const pro = db.getProactive(contactId);

  // Jika AI sudah tidak mau proactive lagi untuk contact ini
  if (pro.aiWantsProactive === false) return;

  // Jika sudah ada jadwal dan belum waktunya
  if (pro.nextProactiveAt && Date.now() < pro.nextProactiveAt) return;

  // Jika belum cukup waktu berlalu (minimal 5 menit sejak pesan terakhir)
  if (minutesSinceLast < (cfg.proactive?.minIntervalMinutes ?? 5)) return;

  // Cek apakah masih dalam batas harian
  if (!db.canSendProactive(contactId)) return;

  // Ambil konteks terakhir
  const recentMsgs = db.getRecentMessages(contactId, 6);
  const context    = recentMsgs
    .map(m => `[${m.role}]: ${m.content}`)
    .join("\n");

  const moodData = db.getAiMood(contactId);

  try {
    // Minta AI memutuskan
    const decision = await decideProactive(context, moodData.mood, minutesSinceLast);

    if (!decision.wantProactive || !decision.message) {
      // AI tidak mau proactive, jadwalkan re-check nanti atau stop
      const shouldStopForever = minutesSinceLast > 60 * 24; // > 24 jam
      if (shouldStopForever) {
        db.updateProactive(contactId, { aiWantsProactive: false });
      } else {
        const nextCheck = Date.now() + (decision.delayMinutes * 60000);
        db.updateProactive(contactId, { nextProactiveAt: nextCheck });
      }
      return;
    }

    // Set jadwal pengiriman
    const sendAt = Date.now() + (decision.delayMinutes * 60000);
    db.updateProactive(contactId, { nextProactiveAt: sendAt });

    // Schedule pengiriman
    setTimeout(async () => {
      await sendProactiveMessage(contactId);
    }, decision.delayMinutes * 60000);

    console.log(`[Proactive] 📅 ${contactId} dijadwalkan dalam ${decision.delayMinutes} menit.`);

  } catch (err) {
    console.error(`[Proactive] Error schedule untuk ${contactId}: ${err.message}`);
  }
}

/**
 * Kirim pesan proaktif ke contact
 */
async function sendProactiveMessage(contactId) {
  if (!_sock) return;
  if (!db.canSendProactive(contactId)) return;

  try {
    const result = await generateProactiveMessage(contactId);
    if (!result || !result.bubbles?.length) return;

    await sendBubbles(_sock, contactId, result.bubbles);

    // Update counter
    const pro      = db.getProactive(contactId);
    const today    = new Date().toDateString();
    const count    = pro.proactiveCountDate === today
      ? (pro.proactiveCountToday || 0) + 1
      : 1;

    db.updateProactive(contactId, {
      lastProactiveAt:     Date.now(),
      nextProactiveAt:     null,
      proactiveCountToday: count,
      proactiveCountDate:  today
    });

    console.log(`[Proactive] ✉️ Proactive terkirim ke ${contactId}`);

    // Setelah kirim, schedule lagi (AI bisa memutuskan)
    setTimeout(() => scheduleProactiveForContact(contactId), 10 * 60000);

  } catch (err) {
    console.error(`[Proactive] Gagal kirim ke ${contactId}: ${err.message}`);
  }
}

/**
 * Jalankan scheduler utama (cek setiap menit)
 */
function startScheduler() {
  if (_isRunning) return;
  _isRunning = true;

  console.log("[Proactive] 🚀 Scheduler dimulai.");

  // Cek setiap 60 detik
  _intervalId = setInterval(async () => {
    const cfg = loadConfig();
    if (!cfg.proactive?.enabled) return;

    const ids = db.getAllContactIds();
    for (const id of ids) {
      try {
        await scheduleProactiveForContact(id);
      } catch { /* ignore per-contact errors */ }
    }
  }, 60 * 1000);
}

/**
 * Stop scheduler
 */
function stopScheduler() {
  if (_intervalId) {
    clearInterval(_intervalId);
    _intervalId = null;
  }
  _isRunning = false;
  console.log("[Proactive] 🛑 Scheduler dihentikan.");
}

/**
 * Reset proactive state untuk contact (misal saat user balas pesan)
 * Ini akan memicu AI untuk jadwalkan ulang
 */
function resetProactiveForContact(contactId) {
  db.updateProactive(contactId, {
    nextProactiveAt:  null,
    aiWantsProactive: true
  });
}

module.exports = {
  setSocket,
  startScheduler,
  stopScheduler,
  scheduleProactiveForContact,
  sendProactiveMessage,
  resetProactiveForContact
};

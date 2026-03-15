<div align="center">

# 🤖 WhatsApp AI Bot

### Powered by **Qwen3-1.7B** — Berjalan 100% Lokal di Mesinmu

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?style=flat-square&logo=python&logoColor=white)](https://python.org)
[![Model](https://img.shields.io/badge/Model-Qwen3--1.7B-FF6B35?style=flat-square&logo=huggingface&logoColor=white)](https://huggingface.co/Qwen/Qwen3-1.7B)
[![License](https://img.shields.io/badge/License-MIT-22c55e?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux%20%7C%20macOS-6366f1?style=flat-square)]()

<br/>

> **Tidak perlu API cloud. Tidak ada biaya per-token. Privasi terjaga penuh.**
> Bot WhatsApp dengan AI lokal, emotional memory, self-learning, dan banyak lagi.

</div>

---

## ✨ Fitur

<table>
<tr>
<td width="50%">

**🔒 Persistent Session**
Login QR sekali, sesi tersimpan di `auth_info/`. Restart bot tanpa scan ulang.

**🎭 Dual Mode AI**
→ **Persona Mode** — Karakter statis (nama, kepribadian kustom)
→ **Adaptive Mirroring** — Mimikri gaya bahasa user secara real-time

**⏱️ Smart Debounce (Anti-Spam)**
Buffer pesan bertubi-tubi selama 7 detik, gabungkan jadi satu, baru proses ke AI.

**😤 Emotional Persistence**
Mood AI (kesal, senang, bosan, dll) menetap **lintas sesi** per kontak — sampai ada pemicu yang mengubahnya.

**🎓 Self-Learning (LoRA Fine-tuning)**
AI belajar otomatis dari akumulasi percakapan menggunakan fine-tuning LoRA yang efisien.

</td>
<td width="50%">

**🧹 Clean Output Filter**
Hapus otomatis blok `<think>...</think>` dari output Qwen3 sebelum sampai ke user.

**💬 Multi-Bubble Delivery**
Jawaban panjang dipecah jadi beberapa balon chat dengan simulasi delay mengetik.

**📩 Proactive Messaging**
AI memutuskan sendiri kapan dan apakah ingin kirim pesan inisiatif.

**⚙️ Konfigurasi Fleksibel**
Whitelist/blacklist nomor, hanya private chat, custom persona, debounce time, dll.

**🗃️ JSON Database Lokal**
Semua chat, mood, timestamp, style profile tersimpan lokal per kontak.

</td>
</tr>
</table>

---

## 🏗️ Arsitektur

```
┌─────────────────────────────────────────────────────────┐
│                    WhatsApp (HP kamu)                   │
└──────────────────────┬──────────────────────────────────┘
                       │ Baileys (WebSocket)
┌──────────────────────▼──────────────────────────────────┐
│              Node.js Bot  (src/bot.js)                  │
│                                                         │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  WA Client  │  │ Msg Handler  │  │   Proactive   │  │
│  │  (Baileys)  │→ │ + Debounce   │→ │   Scheduler   │  │
│  └─────────────┘  └──────┬───────┘  └───────────────┘  │
│                          │                              │
│          ┌───────────────▼──────────────────┐           │
│          │         AI Mode Manager          │           │
│          │  ┌─────────────┐  ┌───────────┐  │           │
│          │  │   Persona   │  │ Adaptive  │  │           │
│          │  │    Mode     │  │ Mirroring │  │           │
│          │  └─────────────┘  └───────────┘  │           │
│          └───────────────┬──────────────────┘           │
│                          │ HTTP (localhost:8000)         │
└──────────────────────────┼──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│           Python Inference Server (FastAPI)             │
│                                                         │
│   ┌─────────────────────────────────────────────────┐   │
│   │          Qwen3-1.7B  (CPU / CUDA GPU)          │   │
│   │        Models/Qwen/  (local weights ~4GB)      │   │
│   │     + LoRA Adapter (setelah fine-tuning)       │   │
│   └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## 📦 Prasyarat

### Hardware Minimum

| Komponen | Minimum | Disarankan |
|----------|---------|------------|
| RAM | 8 GB | 16 GB+ |
| Storage | 6 GB | 10 GB+ |
| GPU | — (CPU OK) | CUDA GPU 6GB+ VRAM |
| CPU | 4 core | 8 core+ |

> ⚠️ **CPU-only:** Respons ~30–60 detik per pesan. Masih fungsional untuk penggunaan santai.

### Software

| Software | Versi | Link |
|----------|-------|------|
| Node.js | v18+ | [nodejs.org](https://nodejs.org) |
| Python | **3.10–3.12** ⭐ | [python.org](https://python.org) |
| pip | latest | (include dengan Python) |
| npm | latest | (include dengan Node.js) |

> ⭐ Python 3.10–3.12 paling stabil. Python 3.13+ bisa jalan tapi butuh fix tambahan (sudah disediakan di `fix_errors.bat`).

---

## 🚀 Instalasi

### 1. Clone Repositori

```bash
git clone https://github.com/yourusername/whatsapp-ai-bot.git
cd whatsapp-ai-bot
```

### 2. Install Dependencies

```bash
# Python dependencies
pip install -r requirements.txt

# Node.js dependencies
npm install
```

> **Windows — ada error saat install?** Jalankan dulu:
> ```cmd
> fix_errors.bat
> ```

### 3. Konfigurasi (Opsional)

Edit `config.json` sesuai kebutuhan. Lihat bagian [Konfigurasi](#%EF%B8%8F-konfigurasi) di bawah.

### 4. Jalankan

**Linux / macOS:**
```bash
chmod +x start.sh
./start.sh
```

**Windows:**
```bat
start.bat
```

**Manual (2 terminal terpisah):**
```bash
# Terminal 1 — Inference Server
# Model Qwen3-1.7B akan didownload otomatis (~4GB) jika belum ada
python inference_server.py

# Terminal 2 — WhatsApp Bot (jalankan setelah server siap)
node src/bot.js
```

### 5. Scan QR Code

Saat pertama kali jalan, QR code muncul di terminal:

```
[WA] 📱 Scan QR Code ini untuk login:

█████████████████████████████
██ ▄▄▄▄▄ █▀ █▀▀ ▄█ ▄▄▄▄▄ ██
██ █   █ █▀▀▀▄▀▄██ █   █ ██
██ █▄▄▄█ █▀▄▀█▀▄██ █▄▄▄█ ██    ← Scan dengan WhatsApp
██▄▄▄▄▄▄▄█▄▀▄█▄▀▄█▄▄▄▄▄▄▄██
█████████████████████████████
```

Buka **WhatsApp → Linked Devices → Link a Device** → scan.

> ✅ Setelah berhasil, sesi tersimpan di `auth_info/`. Bot **tidak akan minta scan ulang** saat restart, kecuali kamu logout manual.

---

## ⚙️ Konfigurasi

Semua setting ada di `config.json`. Berikut opsi-opsi penting:

### 🎭 Persona

```json
"persona": {
  "name": "Aria",
  "description": "Asisten AI yang cerdas dan ramah",
  "personality": "Kamu adalah Aria. Suka berdiskusi dengan antusias, kadang bercanda, tapi tetap helpful. Berbicara natural dalam Bahasa Indonesia."
}
```

### 🛡️ Akses & Keamanan

```json
"bot": {
  "mode": "persona",
  "onlyPrivateChats": true,
  "allowGroupChats": false,
  "allowedNumbers": [],
  "blockNumbers": []
}
```

| Setting | Penjelasan |
|---------|-----------|
| `allowedNumbers` | `[]` = semua boleh. Isi untuk whitelist: `["6281234567890"]` |
| `blockNumbers` | Nomor yang selalu diblokir |
| `onlyPrivateChats` | `true` = hanya balas chat pribadi |

### ⏱️ Timing & Performa

```json
"bot": {
  "debounceMs": 7000,
  "bubbleDelayMs": 900,
  "maxBubbleLength": 800
}
```

| Setting | Default | Penjelasan |
|---------|---------|-----------|
| `debounceMs` | `7000` | ms tunggu setelah pesan terakhir sebelum diproses |
| `bubbleDelayMs` | `900` | ms jeda antar bubble |
| `maxBubbleLength` | `800` | Maks karakter per bubble |

### 📩 Proactive Messaging

```json
"proactive": {
  "enabled": true,
  "minIntervalMinutes": 5,
  "maxIntervalMinutes": 120,
  "maxProactivePerDay": 5
}
```

AI memutuskan sendiri kapan dan apakah ingin kirim pesan. Set `enabled: false` untuk mematikan fitur ini.

---

## 🎭 Mode Bot

### Persona Mode (Default)

Bot berbicara dengan karakter yang dikonfigurasi di `config.json`. Kepribadian dan gaya bahasa konsisten di semua percakapan.

```
# Aktifkan via chat WhatsApp:
!mode persona
```

### Adaptive Mirroring Mode

Bot menganalisis **5–10 pesan terakhir** user, lalu **meniru persis** gaya bahasanya — slang, panjang kalimat, frekuensi emoji, campuran bahasa (ID/EN/mixed).

```
# Aktifkan via chat WhatsApp:
!mode adaptive
```

---

## 💬 Command WhatsApp

Kirim command ini langsung ke bot dari nomor yang diizinkan:

| Command | Fungsi |
|---------|--------|
| `!help` | Tampilkan semua command |
| `!mode persona` | Ganti ke Persona Mode |
| `!mode adaptive` | Ganti ke Adaptive Mirroring |
| `!mood` | Lihat mood AI saat ini |
| `!resetmood` | Reset mood ke neutral |
| `!status` | Info lengkap (mode, mood, jumlah pesan) |
| `!clear` | Hapus history percakapan |

---

## 🖥️ Admin CLI

Kelola bot dari terminal tanpa masuk WhatsApp:

```bash
node cli.js contacts                         # Semua kontak & statistik
node cli.js stats                            # Statistik global

node cli.js mood 628xxx@s.whatsapp.net       # Lihat mood AI
node cli.js mood 628xxx@s.whatsapp.net angry # Set mood manual

node cli.js history 628xxx@s.whatsapp.net 30 # Lihat 30 pesan terakhir
node cli.js clearhistory 628xxx@s.whatsapp.net

node cli.js config                           # Lihat config
node cli.js config set bot.mode adaptive     # Update config
node cli.js config set bot.debounceMs 5000

node cli.js allow 6281234567890              # Whitelist nomor
node cli.js block  6281234567890             # Blacklist nomor

node cli.js finetune                         # Jalankan fine-tuning
node cli.js finetune --force                 # Paksa meski data sedikit
node cli.js backup                           # Backup database
```

---

## 😤 Emotional Persistence

Mood AI bersifat **persistent per kontak** dan **lintas sesi** — menetap bahkan setelah bot di-restart atau jeda berhari-hari.

```
User berdebat panjang dengan bot
  → Bot mood berubah ke "annoyed"
  → Bot di-restart / jeda 2 hari
  → User chat lagi
  → Bot masih "annoyed" ← mood menetap ✅
  → User minta maaf / ganti topik positif
  → Bot mood berubah ke "neutral" atau "happy"
```

**State mood yang tersedia:**

| Mood | Perilaku Bot |
|------|-------------|
| `neutral` | Normal, balanced |
| `happy` | Lebih ekspresif, warm |
| `excited` | Sangat antusias |
| `curious` | Banyak bertanya balik |
| `sad` | Sedikit melankolis |
| `annoyed` | Respons lebih pendek, kurang ramah |
| `angry` | Sangat singkat, kurang kooperatif |
| `bored` | Kurang antusias, butuh topik baru |

---

## 🎓 Self-Learning (Fine-tuning Otomatis)

Bot mengumpulkan percakapan dan melatih ulang dirinya sendiri secara periodik menggunakan **LoRA** (Low-Rank Adaptation):

```
Percakapan terkumpul (min. 30 contoh baru)
  ↓
Setiap 12 jam: cek jumlah data baru
  ↓
Jika cukup: jalankan fine-tuning di background
  ↓
Simpan LoRA adapter → Models/Qwen/adapter/
  ↓
Reload inference server otomatis
  ↓
Bot makin mirip gaya bicaramu 🎯
```

**Jalankan manual:**
```bash
python finetune.py
python finetune.py --force    # Paksa meski data sedikit
```

**Konfigurasi fine-tuning:**
```json
"finetuning": {
  "enabled": true,
  "minExamplesBeforeTrain": 30,
  "checkIntervalHours": 12,
  "loraRank": 16,
  "numEpochs": 2,
  "batchSize": 2
}
```

> 💡 Turunkan `batchSize` ke `1` dan `loraRank` ke `8` jika RAM terbatas.

---

## 📂 Struktur Proyek

```
whatsapp-ai-bot/
│
├── 📄 inference_server.py      Python FastAPI — load & serve Qwen3
├── 📄 finetune.py              LoRA fine-tuning script
├── 📄 config.json              Konfigurasi utama
├── 📄 cli.js                   Admin CLI tool
├── 📄 health_check.js          Cek semua komponen
├── 📄 start.sh / start.bat     Startup script (Linux/Mac/Windows)
├── 📄 fix_errors.bat           Fix dependency errors (Windows)
│
├── 📁 src/
│   ├── bot.js                  Entry point — orchestrate semua modul
│   ├── config.js               Config loader
│   │
│   ├── 📁 ai/
│   │   ├── aiClient.js         HTTP client ke inference server + retry
│   │   ├── contextBuilder.js   Bangun system prompt & chat history
│   │   └── modeManager.js      Orchestrator AI response
│   │
│   ├── 📁 database/
│   │   └── db.js               JSON database manager (per kontak)
│   │
│   ├── 📁 utils/
│   │   ├── bubbleDelivery.js   Multi-bubble + typing simulation
│   │   ├── logger.js           Centralized logger (pino)
│   │   ├── proactive.js        Proactive message scheduler
│   │   ├── textFilter.js       Filter CoT <think>...</think> blocks
│   │   └── validator.js        Input sanitization & injection detect
│   │
│   └── 📁 whatsapp/
│       ├── client.js           Baileys WA client + persistent session
│       └── messageHandler.js   Handler pesan masuk + debounce buffer
│
├── 📁 Models/Qwen/             Model weights (didownload otomatis ~4GB)
│   └── adapter/                LoRA adapter (setelah fine-tuning)
│
├── 📁 auth_info/               ⚠️ Session WhatsApp — JANGAN di-share!
├── 📁 database/                Data JSON per kontak
└── 📁 logs/                    Log files
```

---

## 🔧 Health Check

Verifikasi semua komponen sebelum menjalankan bot:

```bash
node health_check.js
```

Output sukses:
```
╔══════════════════════════════════════════╗
║      WhatsApp AI Bot — Health Check     ║
╚══════════════════════════════════════════╝

[1] Node.js        ✅ Node.js v20.11.0
[2] Config         ✅ config.json OK (mode: persona)
[3] Direktori      ✅ auth_info/  ✅ database/  ✅ Models/Qwen/
[4] Model          ✅ Sudah terdownload
[5] Node deps      ✅ @whiskeysockets/baileys  ✅ axios  ✅ pino
[6] Python         ✅ Python 3.11.0  ✅ torch  ✅ transformers
[7] Inference      ✅ Server berjalan (device: cpu)
[8] WA Session     ✅ Session ditemukan (3 file)

🎉 Semua check passed! Bot siap dijalankan.
```

---

## 🐛 Troubleshooting

<details>
<summary><b>🔄 Bot minta scan QR terus setiap restart</b></summary>

```bash
# Hapus session lama dan buat yang baru
rm -rf auth_info/       # Linux/Mac
rd /s /q auth_info      # Windows CMD
```
</details>

<details>
<summary><b>📦 Error: Cannot find module '...'</b></summary>

Pastikan semua file ada di `src/utils/`:
```
src/utils/validator.js
src/utils/logger.js
src/utils/bubbleDelivery.js
src/utils/proactive.js
src/utils/textFilter.js
```
Lalu install ulang:
```bash
npm install
```
</details>

<details>
<summary><b>🐢 Inference server lambat (respons >60 detik)</b></summary>

Normal untuk CPU-only. Cara mempercepat:
- Kurangi `max_tokens` di `config.json` → `300`
- Gunakan GPU CUDA
- Tutup aplikasi berat lain
</details>

<details>
<summary><b>🪟 Windows: AttributeError / torchvision crash</b></summary>

```cmd
fix_errors.bat
```
Script ini menghapus torchvision yang tidak kompatibel dan memperbaiki semua dependency.
</details>

<details>
<summary><b>💾 OOM (Out of Memory) saat fine-tuning</b></summary>

```json
"finetuning": {
  "batchSize": 1,
  "loraRank": 8
}
```
</details>

<details>
<summary><b>❌ ModuleNotFoundError: Qwen3ForCausalLM</b></summary>

```bash
pip install "transformers>=4.51.0" --upgrade
```
</details>

---

## 🗃️ Format Database

Setiap kontak punya file JSON sendiri di `database/contact_<nomor>.json`:

```json
{
  "contactId": "6281234567890@s.whatsapp.net",
  "aiMood": "happy",
  "aiMoodReason": "User berbagi cerita menyenangkan",
  "messages": [
    {
      "role": "user",
      "content": "Hei, apa kabar?",
      "timestamp": 1710000000000,
      "datetime": "2025-03-10T10:00:00.000Z",
      "aiMoodAtTime": "neutral"
    },
    {
      "role": "assistant",
      "content": "Baik banget! Kamu sendiri gimana?",
      "timestamp": 1710000008000,
      "tokensUsed": 42,
      "inferenceTimeMs": 3200
    }
  ],
  "styleProfile": {
    "slangScore": 0.7,
    "emojiFreq": 0.3,
    "langMix": "mixed",
    "tone": "casual"
  },
  "stats": {
    "totalUserMessages": 42,
    "totalBotMessages": 41
  }
}
```

---

## 🔐 Catatan Keamanan

> ⚠️ **JANGAN pernah commit / share ke publik:**
> - `auth_info/` — kredensial session WhatsApp kamu
> - `database/` — isi percakapan pribadi
>
> Keduanya sudah masuk `.gitignore` secara default.

---

## 📋 Tech Stack

| Layer | Teknologi |
|-------|-----------|
| WhatsApp Client | [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys) |
| AI Model | [Qwen/Qwen3-1.7B](https://huggingface.co/Qwen/Qwen3-1.7B) |
| Inference Server | [FastAPI](https://fastapi.tiangolo.com) + [Uvicorn](https://www.uvicorn.org) |
| ML Framework | [PyTorch](https://pytorch.org) + [HuggingFace Transformers](https://huggingface.co/docs/transformers) |
| Fine-tuning | [PEFT/LoRA](https://github.com/huggingface/peft) + [TRL](https://github.com/huggingface/trl) |
| Database | JSON flat-file (per kontak) |
| Logging | [Pino](https://getpino.io) |
| Scheduler | [node-cron](https://github.com/node-cron/node-cron) |

---

## 📄 Lisensi

MIT License — bebas digunakan dan dimodifikasi untuk keperluan pribadi maupun komersial.

---

<div align="center">

Dibuat dengan ☕ dan banyak debugging

[⬆ Kembali ke atas](#-whatsapp-ai-bot)

</div>

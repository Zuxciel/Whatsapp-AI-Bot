# 🤖 WhatsApp AI Bot — Qwen3-1.7B (Local)

Bot WhatsApp berbasis AI lokal menggunakan model **Qwen/Qwen3-1.7B** yang berjalan 100% di mesin kamu. Tidak perlu API cloud, tidak ada biaya per-token, privasi terjaga.

---

## ✨ Fitur Utama

| Fitur | Deskripsi |
|-------|-----------|
| 🔒 Persistent Session | Login QR sekali, sesi tersimpan otomatis di `auth_info/` |
| 🎭 Dual Mode | **Persona Mode** (karakter statis) & **Adaptive Mirroring** (mimikri gaya user) |
| ⏱️ Smart Debounce | Buffer pesan bertubi-tubi 7 detik, baru diproses sekaligus |
| 🧹 Clean Output | Filter otomatis blok `<think>...</think>` sebelum sampai ke user |
| 💬 Multi-Bubble | Jawaban panjang dipecah jadi beberapa balon dengan delay typing |
| 📩 Proactive Message | AI memutuskan sendiri kapan ingin mengirim pesan inisiatif |
| ⚙️ Flexible Config | Whitelist/blacklist nomor, hanya private chat, dll |
| 🗃️ JSON Database | Semua chat, mood, timestamp, style profile tersimpan lokal |
| 🎓 Self-Learning | Fine-tuning LoRA otomatis dari akumulasi percakapan |
| 😤 Emotional Persistence | Mood AI menetap per-kontak, bahkan lintas sesi |

---

## 📦 Prasyarat

### Hardware
- **RAM**: Minimal 8 GB (16 GB+ disarankan)
- **Storage**: ~5 GB untuk model Qwen3-1.7B
- **GPU** (opsional): CUDA-compatible GPU untuk inferensi lebih cepat
- CPU-only tetap bisa berjalan, tapi lebih lambat (~30-60 detik/respons)

### Software
- **Node.js** v18 atau lebih baru → [nodejs.org](https://nodejs.org)
- **Python** 3.10 atau lebih baru → [python.org](https://python.org)
- **pip** (biasanya sudah include dengan Python)
- **npm** (sudah include dengan Node.js)

---

## 🚀 Cara Instalasi

### 1. Clone / Download Proyek

```bash
git clone https://github.com/yourusername/whatsapp-ai-bot.git
cd whatsapp-ai-bot
```

Atau download ZIP dan ekstrak.

### 2. Install Dependencies

**Python:**
```bash
pip install -r requirements.txt
```

**Node.js:**
```bash
npm install
```

### 3. Konfigurasi (Opsional)

Edit `config.json` sesuai kebutuhan (lihat bagian [Konfigurasi](#-konfigurasi) di bawah).

### 4. Jalankan Bot

**Linux / macOS:**
```bash
chmod +x start.sh
./start.sh
```

**Windows:**
```bat
start.bat
```

**Manual (2 terminal):**
```bash
# Terminal 1 — Inference Server
python inference_server.py

# Terminal 2 — WhatsApp Bot (setelah server siap)
node src/bot.js
```

### 5. Scan QR Code

Pertama kali dijalankan, QR code akan muncul di terminal.
Buka WhatsApp di HP → **Linked Devices** → **Link a Device** → Scan QR.

> ✅ Setelah berhasil, sesi tersimpan di `auth_info/`. Bot **tidak akan minta scan ulang** saat direstart, kecuali kamu logout manual.

---

## ⚙️ Konfigurasi

Semua konfigurasi ada di file `config.json`:

### Bot Settings

```json
"bot": {
  "mode": "persona",         // "persona" atau "adaptive"
  "allowedNumbers": [],      // [] = semua boleh, isi nomor untuk whitelist
  "blockNumbers": [],        // Blacklist nomor
  "allowGroupChats": false,  // true = bot juga aktif di grup
  "onlyPrivateChats": true,  // Hanya balas chat pribadi
  "debounceMs": 7000,        // ms tunggu sebelum proses pesan (anti-spam)
  "bubbleDelayMs": 900,      // ms antar bubble
  "maxBubbleLength": 800,    // Max karakter per bubble
  "typingSimulation": true   // Tampilkan indikator "mengetik..."
}
```

### Persona Settings

```json
"persona": {
  "name": "Aria",
  "description": "Asisten AI yang cerdas dan ramah",
  "personality": "Kamu adalah Aria... (deskripsi karakter)"
}
```

### Whitelist Nomor

```json
"bot": {
  "allowedNumbers": ["628123456789", "628987654321"]
}
```

Kosongkan (`[]`) untuk mengizinkan semua nomor.

### Proactive Messaging

```json
"proactive": {
  "enabled": true,
  "minIntervalMinutes": 5,    // Jeda minimal antar proactive
  "maxIntervalMinutes": 120,  // Jeda maksimal
  "maxProactivePerDay": 5     // Batas proactive per hari per kontak
}
```

---

## 🎭 Mode Bot

### Persona Mode (Default)

Bot berbicara dengan karakter yang sudah dikonfigurasi di `config.json → persona`. Nama, deskripsi, dan kepribadian statis.

**Ganti via command WhatsApp:**
```
!mode persona
```

### Adaptive Mirroring Mode

Bot menganalisis 5–10 pesan terakhir user dan **meniru persis** gaya bahasanya: slang, panjang kalimat, frekuensi emoji, campuran bahasa.

**Ganti via command WhatsApp:**
```
!mode adaptive
```

**Ganti via CLI:**
```bash
node cli.js config set bot.mode adaptive
```

---

## 💬 Command WhatsApp

Kirim command ini ke bot dari nomor yang diizinkan:

| Command | Fungsi |
|---------|--------|
| `!help` | Daftar semua command |
| `!mode persona` | Ganti ke persona mode |
| `!mode adaptive` | Ganti ke adaptive mirroring |
| `!mood` | Lihat mood AI saat ini |
| `!resetmood` | Reset mood ke neutral |
| `!status` | Info lengkap bot (mode, mood, jumlah pesan) |
| `!clear` | Hapus history percakapan |

---

## 🖥️ Admin CLI

Tool command line untuk manajemen bot tanpa masuk WhatsApp:

```bash
# Lihat semua kontak
node cli.js contacts

# Lihat/set mood AI untuk kontak tertentu
node cli.js mood 628123456789@s.whatsapp.net
node cli.js mood 628123456789@s.whatsapp.net angry

# Lihat history chat
node cli.js history 628123456789@s.whatsapp.net 30

# Lihat/update config
node cli.js config
node cli.js config set bot.mode adaptive
node cli.js config set bot.debounceMs 5000

# Statistik global
node cli.js stats

# Whitelist/blacklist nomor
node cli.js allow 628123456789
node cli.js block 628111222333

# Hapus history kontak
node cli.js clearhistory 628123456789@s.whatsapp.net

# Jalankan fine-tuning sekarang
node cli.js finetune
node cli.js finetune --force   # Paksa meski data sedikit

# Backup database
node cli.js backup
```

---

## 🎓 Fine-Tuning (Belajar Mandiri)

Bot secara otomatis mengumpulkan pasangan percakapan dari semua chat dan melatih ulang model menggunakan **LoRA** (Low-Rank Adaptation) secara periodik.

### Cara Kerja
1. Setiap pesan user + respons bot disimpan ke database
2. Setiap **N jam** (default: 12 jam), bot cek apakah ada cukup contoh baru
3. Jika ≥ 30 contoh baru, fine-tuning dijalankan otomatis di background
4. Adapter LoRA disimpan ke `Models/Qwen/adapter/`
5. Inference server di-reload otomatis

### Konfigurasi Fine-Tuning

```json
"finetuning": {
  "enabled": true,
  "minExamplesBeforeTrain": 30,  // Min contoh sebelum mulai training
  "checkIntervalHours": 12,       // Cek setiap N jam
  "loraRank": 16,                 // Rank LoRA (lebih tinggi = lebih ekspresif, lebih lambat)
  "loraAlpha": 32,
  "learningRate": 0.0002,
  "numEpochs": 2,
  "batchSize": 2                  // Turunkan jika RAM/VRAM kurang
}
```

### Jalankan Manual

```bash
python finetune.py             # Normal
python finetune.py --force     # Paksa meski data sedikit
python finetune.py --min-examples 10
```

---

## 😤 Emotional Persistence

Mood AI bersifat **persistent per kontak** dan **lintas sesi**. Jika bot sedang "kesal" karena perdebatan sebelumnya, mood itu akan menetap di chat berikutnya dengan kontak yang sama, bahkan setelah bot di-restart.

### Mood States
- `neutral` — Kondisi normal
- `happy` — Senang, lebih ekspresif
- `curious` — Penasaran, banyak bertanya
- `excited` — Sangat antusias
- `sad` — Sedikit sedih/melankolis
- `angry` — Kesal, respons lebih pendek dan kurang ramah
- `annoyed` — Terganggu
- `bored` — Bosan

### Cara Reset Mood
```
# Via WhatsApp
!resetmood

# Via CLI
node cli.js mood 628xxx@s.whatsapp.net neutral
```

---

## 📂 Struktur Proyek

```
whatsapp-ai-bot/
├── src/
│   ├── bot.js                    # Entry point utama
│   ├── config.js                 # Config loader
│   ├── ai/
│   │   ├── aiClient.js           # HTTP client ke inference server
│   │   ├── contextBuilder.js     # Bangun system prompt & messages
│   │   └── modeManager.js        # Orchestrator AI response
│   ├── database/
│   │   └── db.js                 # JSON database manager
│   ├── utils/
│   │   ├── bubbleDelivery.js     # Multi-bubble delivery + typing sim
│   │   ├── logger.js             # Centralized logger
│   │   ├── proactive.js          # Proactive message scheduler
│   │   ├── textFilter.js         # Filter CoT thinking blocks
│   │   └── validator.js          # Input sanitization
│   └── whatsapp/
│       ├── client.js             # Baileys WA client + auth
│       └── messageHandler.js     # Handler pesan masuk + debounce
├── inference_server.py           # Python FastAPI inference server
├── finetune.py                   # LoRA fine-tuning script
├── cli.js                        # Admin CLI
├── health_check.js               # Health check tool
├── config.json                   # Konfigurasi utama
├── package.json
├── requirements.txt
├── start.sh                      # Startup script (Linux/Mac)
├── start.bat                     # Startup script (Windows)
├── auth_info/                    # Session WhatsApp (jangan di-share!)
├── database/                     # Database JSON per kontak
├── logs/                         # Log files
└── Models/
    └── Qwen/                     # Model Qwen3-1.7B
        └── adapter/              # LoRA adapter (setelah fine-tuning)
```

---

## 🔧 Health Check

Jalankan sebelum menjalankan bot untuk memverifikasi semua komponen:

```bash
node health_check.js
```

Output akan menunjukkan status:
- ✅ Node.js version
- ✅ Config valid
- ✅ Direktori tersedia
- ✅ Model sudah terdownload
- ✅ Node dependencies terinstall
- ✅ Python dependencies terinstall
- ✅/❌ Inference server berjalan
- ✅ WhatsApp session tersimpan

---

## 🐛 Troubleshooting

### Bot meminta scan QR terus
Hapus folder `auth_info/` dan restart:
```bash
rm -rf auth_info/
node src/bot.js
```

### Inference server lambat (CPU-only)
Normal untuk CPU. Respons 30–60 detik adalah wajar untuk model 1.7B di CPU.
Untuk mempercepat, gunakan GPU CUDA atau kurangi `max_tokens` di config.

### Error "Model belum siap"
Tunggu beberapa menit setelah inference_server.py dijalankan. Model perlu waktu untuk load ke memori.

### OOM (Out of Memory) saat fine-tuning
Kurangi `batchSize` ke `1` dan `loraRank` ke `8` di config.json.

### Bot tidak merespons pesan tertentu
Cek log di `logs/` dan pastikan nomor pengirim tidak ada di `blockNumbers` dan ada di `allowedNumbers` (jika whitelist aktif).

---

## 📝 Database JSON

Setiap kontak memiliki file sendiri di `database/contact_<nomor>.json` berisi:

```json
{
  "contactId": "628xxx@s.whatsapp.net",
  "aiMood": "happy",
  "aiMoodReason": "User berbagi cerita menyenangkan",
  "messages": [
    {
      "id": "uuid",
      "role": "user",
      "content": "Hei, apa kabar?",
      "timestamp": 1703000000000,
      "datetime": "2024-12-19T10:00:00.000Z",
      "aiMoodAtTime": "neutral"
    }
  ],
  "styleProfile": {
    "slangScore": 0.7,
    "langMix": "mixed"
  },
  "stats": {
    "totalUserMessages": 42,
    "totalBotMessages": 41
  }
}
```

---

## ⚠️ Catatan Penting

1. **Jangan share folder `auth_info/`** — berisi kredensial WhatsApp kamu
2. **Model ~3-5 GB** — pastikan ada ruang disk yang cukup
3. **Fine-tuning butuh RAM lebih** — pastikan tidak ada aplikasi berat lain berjalan
4. **Bot hanya aktif saat laptop/server menyala** — untuk 24/7, deploy ke VPS/server

---

## 📄 Lisensi

MIT License — bebas digunakan dan dimodifikasi untuk keperluan pribadi maupun komersial.

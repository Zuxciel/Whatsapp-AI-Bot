#!/usr/bin/env bash
# =============================================================
#  start.sh — Script untuk menjalankan seluruh sistem bot
#  Jalankan: chmod +x start.sh && ./start.sh
# =============================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo -e "${CYAN}"
echo "╔══════════════════════════════════════════════════════════╗"
echo "║       WhatsApp AI Bot — Qwen3-1.7B (Local)              ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# ─── CEK DEPENDENCIES ───────────────────────────────────────
echo -e "${BLUE}[1/5]${NC} Mengecek dependencies..."

if ! command -v python3 &>/dev/null && ! command -v python &>/dev/null; then
    echo -e "${RED}❌ Python tidak ditemukan! Install Python 3.10+ dulu.${NC}"
    exit 1
fi

PYTHON_CMD=$(command -v python3 || command -v python)
echo -e "  ✅ Python: $($PYTHON_CMD --version)"

if ! command -v node &>/dev/null; then
    echo -e "${RED}❌ Node.js tidak ditemukan! Install Node.js 18+ dulu.${NC}"
    exit 1
fi
echo -e "  ✅ Node.js: $(node --version)"

# ─── INSTALL PYTHON DEPS ─────────────────────────────────────
echo -e "\n${BLUE}[2/5]${NC} Mengecek Python dependencies..."
$PYTHON_CMD -c "import fastapi, uvicorn, torch, transformers" 2>/dev/null || {
    echo -e "  ${YELLOW}⚙️  Menginstall Python dependencies...${NC}"
    $PYTHON_CMD -m pip install -r requirements.txt --quiet
    echo -e "  ✅ Python deps terinstall."
}
echo -e "  ✅ Python deps OK."

# ─── INSTALL NODE DEPS ───────────────────────────────────────
echo -e "\n${BLUE}[3/5]${NC} Mengecek Node.js dependencies..."
if [ ! -d "node_modules" ]; then
    echo -e "  ${YELLOW}⚙️  Menginstall Node.js dependencies...${NC}"
    npm install --silent
    echo -e "  ✅ Node deps terinstall."
else
    echo -e "  ✅ node_modules sudah ada."
fi

# ─── CREATE DIRECTORIES ──────────────────────────────────────
echo -e "\n${BLUE}[4/5]${NC} Membuat direktori yang diperlukan..."
mkdir -p auth_info database logs Models/Qwen
echo -e "  ✅ Direktori siap."

# ─── MULAI INFERENCE SERVER ──────────────────────────────────
echo -e "\n${BLUE}[5/5]${NC} Menjalankan sistem..."

# Cek apakah inference server sudah running
if curl -s http://localhost:8000/health > /dev/null 2>&1; then
    echo -e "  ✅ Inference server sudah berjalan."
else
    echo -e "  ${YELLOW}🚀 Memulai Inference Server (background)...${NC}"
    echo -e "  ${YELLOW}   (Download model jika belum ada — bisa lama!)${NC}"
    $PYTHON_CMD inference_server.py > logs/inference_server.log 2>&1 &
    INFERENCE_PID=$!
    echo "  📋 PID Inference Server: $INFERENCE_PID"
    echo $INFERENCE_PID > logs/inference_server.pid
fi

# ─── MULAI WHATSAPP BOT ──────────────────────────────────────
echo -e "\n  ${GREEN}🤖 Memulai WhatsApp Bot...${NC}"
echo -e "  ${YELLOW}   Tunggu inference server siap (bisa 2-5 menit pertama kali)${NC}"
echo ""

# Trap untuk cleanup
cleanup() {
    echo -e "\n${YELLOW}[Shutdown] Menghentikan semua proses...${NC}"
    if [ -f logs/inference_server.pid ]; then
        kill "$(cat logs/inference_server.pid)" 2>/dev/null || true
        rm -f logs/inference_server.pid
    fi
    exit 0
}
trap cleanup SIGINT SIGTERM

# Jalankan bot (foreground agar log terlihat)
node src/bot.js

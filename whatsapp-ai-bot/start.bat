@echo off
REM ============================================================
REM  start.bat — Startup Script untuk Windows
REM  Jalankan: start.bat
REM ============================================================

title WhatsApp AI Bot - Qwen3-1.7B

echo.
echo ╔══════════════════════════════════════════════════════════╗
echo ║       WhatsApp AI Bot — Qwen3-1.7B (Local)              ║
echo ╚══════════════════════════════════════════════════════════╝
echo.

REM ─── Buat direktori yang diperlukan ────────────────────────
if not exist "auth_info"   mkdir auth_info
if not exist "database"    mkdir database
if not exist "logs"        mkdir logs
if not exist "Models\Qwen" mkdir Models\Qwen

REM ─── Cek versi Python ───────────────────────────────────────
echo [0/4] Cek Python version...
for /f "tokens=2 delims= " %%v in ('python --version 2^>^&1') do set PYVER=%%v
echo       Python %PYVER% terdeteksi.

REM ─── Fix pyreadline (Python 3.10+ compatibility) ────────────
echo [1/4] Fix pyreadline compatibility...
pip show pyreadline >nul 2>&1 && (
    echo       Menghapus pyreadline lama yang tidak kompatibel...
    pip uninstall pyreadline -y >nul 2>&1
)
pip show pyreadline3 >nul 2>&1 || (
    echo       Install pyreadline3...
    pip install pyreadline3 >nul 2>&1
)
echo       OK.

REM ─── Install Python dependencies ───────────────────────────
echo [2/4] Mengecek Python dependencies...
python -c "import torch, fastapi, transformers" >nul 2>&1 || (
    echo       Menginstall Python dependencies ^(bisa beberapa menit^)...
    pip install -r requirements.txt
)
echo       OK.

REM ─── Install Node dependencies ─────────────────────────────
echo [3/4] Mengecek Node.js dependencies...
if not exist "node_modules" (
    echo       Menginstall Node.js dependencies...
    npm install
)
echo       OK.

REM ─── Start Inference Server ─────────────────────────────────
echo [4/4] Memulai Inference Server di background...
start "Qwen Inference Server" cmd /k "python inference_server.py 2>&1 | tee logs\inference_server.log"
echo       Inference server berjalan di jendela terpisah.
echo       Download model otomatis jika belum ada ^(bisa 10-30 menit^).

REM ─── Delay ──────────────────────────────────────────────────
timeout /t 5 /nobreak >nul

REM ─── Start WhatsApp Bot ──────────────────────────────────────
echo.
echo Memulai WhatsApp Bot...
echo ^(Bot akan menunggu inference server siap otomatis^)
echo.
node src/bot.js

pause

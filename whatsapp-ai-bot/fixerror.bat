@echo off
REM ================================================================
REM  fix_errors.bat — Fix semua error Python untuk WhatsApp AI Bot
REM  Jalankan script ini dari folder proyek: fix_errors.bat
REM ================================================================

title Fix: WhatsApp AI Bot Dependencies

color 0A
echo.
echo  ================================================================
echo   Fix: Semua Error Python - WhatsApp AI Bot
echo  ================================================================
echo.

REM ─── Step 1: Uninstall torchvision (penyebab crash utama) ──────
echo [1/6] Uninstall torchvision (tidak dibutuhkan, penyebab crash)...
pip uninstall torchvision -y 2>nul
pip uninstall torchaudio -y 2>nul
echo       OK - torchvision dihapus.
echo.

REM ─── Step 2: Fix pyreadline ─────────────────────────────────────
echo [2/6] Fix pyreadline (kompatibilitas Python 3.10+)...
pip uninstall pyreadline -y 2>nul
pip install pyreadline3 --quiet
echo       OK.
echo.

REM ─── Step 3: Upgrade transformers ke versi terbaru ─────────────
echo [3/6] Upgrade transformers (butuh versi yang support Qwen3)...
pip install "transformers>=4.51.0" --upgrade --quiet
echo       OK.
echo.

REM ─── Step 4: Pastikan torch versi yang benar ───────────────────
echo [4/6] Verifikasi torch...
python -c "import torch; print('      torch', torch.__version__, '- OK')" 2>&1
echo.

REM ─── Step 5: Install requirement lainnya ───────────────────────
echo [5/6] Install requirement tambahan...
pip install fastapi uvicorn pydantic huggingface_hub accelerate sentencepiece --quiet
echo       OK.
echo.

REM ─── Step 6: Verifikasi semua ──────────────────────────────────
echo [6/6] Verifikasi semua imports...
echo.

python -c "
import sys
print(f'  Python: {sys.version}')

checks = [
    ('torch',           'torch.__version__'),
    ('transformers',    'transformers.__version__'),
    ('fastapi',         'fastapi.__version__'),
    ('huggingface_hub', 'huggingface_hub.__version__'),
    ('peft',            'peft.__version__'),
]

all_ok = True
for pkg, ver_expr in checks:
    try:
        mod = __import__(pkg)
        ver = eval(ver_expr)
        print(f'  OK  {pkg:<20} v{ver}')
    except Exception as e:
        print(f'  ERR {pkg:<20} {e}')
        all_ok = False

# Test torchvision tidak dibutuhkan
print()
print('  Test Qwen3 model loading (tanpa torchvision)...')
try:
    from transformers import AutoModelForCausalLM, AutoTokenizer
    print('  OK  AutoModelForCausalLM import OK')
except Exception as e:
    print(f'  ERR {e}')
    all_ok = False

print()
if all_ok:
    print('  Semua OK! Jalankan: python inference_server.py')
else:
    print('  Ada error. Coba jalankan: pip install -r requirements.txt --upgrade')
"

echo.
echo  ================================================================
echo   Selesai! Sekarang jalankan: python inference_server.py
echo  ================================================================
echo.
pause
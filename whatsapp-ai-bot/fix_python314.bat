@echo off
REM ============================================================
REM  fix_python314.bat
REM  Fix error pyreadline / collections.Callable di Python 3.10+
REM ============================================================

echo.
echo [Fix] Menghapus pyreadline yang tidak kompatibel...
pip uninstall pyreadline -y 2>nul
pip uninstall readline -y 2>nul

echo [Fix] Menginstall pyreadline3 (versi yang support Python 3.10+)...
pip install pyreadline3

echo.
echo [Fix] Re-install requirements utama...
pip install -r requirements.txt --upgrade

echo.
echo [Fix] Verifikasi torch bisa diimport...
python -c "import torch; print('[OK] torch', torch.__version__)"
python -c "import transformers; print('[OK] transformers', transformers.__version__)"
python -c "import fastapi; print('[OK] fastapi OK')"

echo.
echo [Done] Sekarang coba jalankan lagi: python inference_server.py
pause

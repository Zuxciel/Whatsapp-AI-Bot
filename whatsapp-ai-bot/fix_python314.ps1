# fix_python314.ps1 — Jalankan di PowerShell sebagai Admin
# Fix: AttributeError: module 'collections' has no attribute 'Callable'

Write-Host "`n[Fix] Python 3.14 Compatibility Fix" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan

# Step 1: Hapus pyreadline lama
Write-Host "`n[1/4] Menghapus pyreadline yang bermasalah..." -ForegroundColor Yellow
pip uninstall pyreadline -y 2>$null
pip uninstall readline -y 2>$null
Write-Host "      Done." -ForegroundColor Green

# Step 2: Install pyreadline3
Write-Host "`n[2/4] Install pyreadline3 (kompatibel Python 3.10+)..." -ForegroundColor Yellow
pip install pyreadline3
Write-Host "      Done." -ForegroundColor Green

# Step 3: Install/update semua requirements
Write-Host "`n[3/4] Update semua dependencies..." -ForegroundColor Yellow
pip install -r requirements.txt --upgrade
Write-Host "      Done." -ForegroundColor Green

# Step 4: Verifikasi
Write-Host "`n[4/4] Verifikasi imports..." -ForegroundColor Yellow
$checks = @("torch", "transformers", "fastapi", "uvicorn", "peft")
foreach ($pkg in $checks) {
    $result = python -c "import $pkg; print('$pkg OK')" 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "      OK: $pkg" -ForegroundColor Green
    } else {
        Write-Host "      FAIL: $pkg -> $result" -ForegroundColor Red
    }
}

Write-Host "`n[Done] Sekarang jalankan: python inference_server.py" -ForegroundColor Cyan

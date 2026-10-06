$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$venvPython = Join-Path $projectRoot ".venv\Scripts\python.exe"

if (-not (Test-Path -LiteralPath $venvPython)) {
    throw "Falta .venv. Ejecuta: python -m venv .venv; .\.venv\Scripts\python.exe -m pip install -r local_flux\requirements.txt"
}

$env:GENERATION_PROVIDER = "local"
$env:LOCAL_FLUX_URL = "http://127.0.0.1:8188"
$env:LOCAL_FLUX_MODEL = "black-forest-labs/FLUX.2-klein-4B"
$env:FLUX_BASE_SEED = "481976"
$env:LOCAL_FLUX_STEPS = "4"
$env:LOCAL_FLUX_DEFAULT_REFERENCES = "5"
$env:LOCAL_FLUX_INSECURE_HF = "1"

$fluxProcess = Start-Process -FilePath $venvPython `
    -ArgumentList "local_flux/server.py" `
    -WorkingDirectory $projectRoot `
    -WindowStyle Hidden `
    -PassThru

try {
    Write-Host "Cargando FLUX.2 Klein 4B en la GPU..."
    $ready = $false
    for ($attempt = 0; $attempt -lt 180; $attempt++) {
        try {
            $health = Invoke-RestMethod -Uri "http://127.0.0.1:8188/health" -TimeoutSec 2
            if ($health.ok) { $ready = $true; break }
        } catch { Start-Sleep -Seconds 2 }
    }
    if (-not $ready) { throw "El servicio local no respondió en 6 minutos." }
    Write-Host "FLUX local listo. npm run dev abrirá Next y el editor Timeline"
    Write-Host "Abriendo Video Lab Ai en http://localhost:3000"
    npm run dev
} finally {
    if (-not $fluxProcess.HasExited) { Stop-Process -Id $fluxProcess.Id }
}

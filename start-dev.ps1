# ==========================================================
# 🐾 Doggo App - Script de démarrage tout-en-un (PowerShell)
# Lance MongoDB, le Backend FastAPI et Expo en une seule commande !
# ==========================================================

$ErrorActionPreference = "Continue"

Write-Host "`n==========================================" -ForegroundColor Cyan
Write-Host "🐾 Démarrage de Doggo App (All-In-One)" -ForegroundColor Cyan
Write-Host "==========================================`n" -ForegroundColor Cyan

$rootDir = $PSScriptRoot
$backendDir = Join-Path $rootDir "backend"
$frontendDir = Join-Path $rootDir "frontend"

# 1. Vérification / Lancement de MongoDB
Write-Host "[1/3] Vérification de MongoDB..." -ForegroundColor Yellow
$mongoRunning = $false
try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $iar = $tcp.BeginConnect("127.0.0.1", 27017, $null, $null)
    $success = $iar.AsyncWaitHandle.WaitOne(1000, $false)
    if ($success -and $tcp.Connected) {
        $tcp.EndConnect($iar)
        $tcp.Close()
        $mongoRunning = $true
        Write-Host " ✔ MongoDB est déjà actif sur le port 27017." -ForegroundColor Green
    } else {
        $tcp.Close()
    }
} catch {}

if (-not $mongoRunning) {
    if (Get-Command docker -ErrorAction SilentlyContinue) {
        Write-Host " ℹ Démarrage du conteneur MongoDB via Docker Compose..." -ForegroundColor Cyan
        docker compose up -d mongodb
        Start-Sleep -Seconds 2
        Write-Host " ✔ MongoDB démarré dans Docker." -ForegroundColor Green
    } else {
        Write-Host " ⚠ MongoDB n'est pas détecté sur le port 27017 et Docker n'a pas été trouvé." -ForegroundColor DarkYellow
        Write-Host "   Si vous utilisez MongoDB localement, assurez-vous que le service est lancé." -ForegroundColor DarkGray
    }
}

# 2. Détection de l'IP locale pour Expo Go
Write-Host "`n[2/3] Configuration du réseau pour Expo Go..." -ForegroundColor Yellow
$localIp = $null
try {
    $ipObj = Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
        $_.InterfaceAlias -notmatch 'Loopback|vEthernet|WSL|Default Switch|Virtual' -and 
        $_.IPAddress -notmatch '^127\.|^169\.254\.'
    } | Select-Object -First 1
    if ($ipObj) { $localIp = $ipObj.IPAddress }
} catch {}

if (-not $localIp) { $localIp = "localhost" }
Write-Host " ✔ IP locale détectée : $localIp" -ForegroundColor Green
Write-Host " ✔ URL de l'API Backend : http://${localIp}:8000" -ForegroundColor Green

# Création / Mise à jour de frontend/.env
$frontendEnv = Join-Path $frontendDir ".env"
$frontendEnvExample = Join-Path $frontendDir ".env.example"
$backendUrlLine = "EXPO_PUBLIC_BACKEND_URL=http://${localIp}:8000"

if (-not (Test-Path $frontendEnv)) {
    if (Test-Path $frontendEnvExample) {
        $content = Get-Content $frontendEnvExample -Raw
        $content = $content -replace "EXPO_PUBLIC_BACKEND_URL=.*", $backendUrlLine
        Set-Content -Path $frontendEnv -Value $content
    } else {
        Set-Content -Path $frontendEnv -Value "$backendUrlLine`n"
    }
    Write-Host " ✔ Fichier frontend/.env configuré avec l'IP $localIp" -ForegroundColor Green
}

# 3. Préparation & Démarrage du Backend
Write-Host "`n[3/3] Démarrage du Backend FastAPI..." -ForegroundColor Yellow
$venvDir = Join-Path $backendDir "venv"
$venvPython = Join-Path $venvDir "Scripts\python.exe"

if (-not (Test-Path $venvPython)) {
    Write-Host " ℹ Création de l'environnement virtuel Python (backend/venv)..." -ForegroundColor Cyan
    python -m venv $venvDir
    Write-Host " ℹ Installation des dépendances Python..." -ForegroundColor Cyan
    & $venvPython -m pip install --upgrade pip
    & $venvPython -m pip install -r (Join-Path $backendDir "requirements.txt")
}

# Lancement du backend en arrière-plan
$backendProc = Start-Process -FilePath $venvPython -ArgumentList "-m uvicorn server:app --host 0.0.0.0 --port 8000 --reload" -WorkingDirectory $backendDir -PassThru -NoNewWindow
Write-Host " ✔ Backend démarré (PID: $($backendProc.Id)) sur http://localhost:8000" -ForegroundColor Green
Write-Host " ✔ Documentation Swagger : http://localhost:8000/docs" -ForegroundColor DarkCyan

# 4. Installation dépendances Frontend si nécessaire
if (-not (Test-Path (Join-Path $frontendDir "node_modules"))) {
    Write-Host "`n ℹ Installation des dépendances NPM / Expo..." -ForegroundColor Cyan
    Set-Location $frontendDir
    if (Get-Command yarn -ErrorAction SilentlyContinue) {
        yarn install
    } else {
        npm install
    }
    Set-Location $rootDir
}

# 5. Lancement d'Expo au premier plan
Write-Host "`n==========================================" -ForegroundColor Green
Write-Host "🚀 Lancement du serveur Expo" -ForegroundColor Green
Write-Host "📱 Scannez le QR code avec l'application Expo Go" -ForegroundColor Green
Write-Host "🌐 Tapez 'w' dans la console pour ouvrir dans le navigateur" -ForegroundColor DarkCyan
Write-Host "🛑 Appuyez sur Ctrl+C pour TOUT arrêter proprement" -ForegroundColor DarkYellow
Write-Host "==========================================`n" -ForegroundColor Green

try {
    Set-Location $frontendDir
    npx expo start
} finally {
    Write-Host "`nArrêt du serveur Backend..." -ForegroundColor Yellow
    if ($backendProc -and -not $backendProc.HasExited) {
        Stop-Process -Id $backendProc.Id -Force -ErrorAction SilentlyContinue
    }
    Set-Location $rootDir
    Write-Host "✔ Tous les services ont été arrêtés. À bientôt !" -ForegroundColor Green
}

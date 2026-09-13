# ==========================================================
# 🐾 Doggo App - Script de démarrage tout-en-un (PowerShell)
# Compatible Windows PowerShell 5.1 & PowerShell Core 7+
# ==========================================================

$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "🐾 Démarrage de Doggo App (All-In-One)" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

$rootDir = $PSScriptRoot
if (-not $rootDir) { $rootDir = (Get-Location).Path }
$backendDir = Join-Path $rootDir "backend"
$frontendDir = Join-Path $rootDir "frontend"

# 1. Vérification / Lancement de MongoDB
Write-Host "[1/3] Vérification de MongoDB..." -ForegroundColor Yellow
$mongoRunning = $false

try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $tcp.Connect("127.0.0.1", 27017)
    $tcp.Close()
    $mongoRunning = $true
    Write-Host " ✔ MongoDB est déjà actif sur le port 27017." -ForegroundColor Green
} catch {
    $null = $_
}

if (-not $mongoRunning) {
    if (Get-Command docker -ErrorAction SilentlyContinue) {
        Write-Host " ℹ Démarrage de MongoDB via Docker Compose..." -ForegroundColor Cyan
        try {
            docker compose up -d mongodb
            Start-Sleep -Seconds 2
            Write-Host " ✔ MongoDB démarré dans Docker." -ForegroundColor Green
            $mongoRunning = $true
        } catch {
            Write-Host " ⚠ Erreur lors du lancement de Docker compose." -ForegroundColor Red
        }
    } else {
        Write-Host " ⚠ MongoDB n'est pas détecté sur le port 27017 et Docker n'a pas été trouvé." -ForegroundColor DarkYellow
        Write-Host "   Si vous utilisez MongoDB installé en local, assurez-vous que le service MongoDB tourne." -ForegroundColor DarkGray
    }
}

# 2. Détection de l'IP locale pour Expo Go
Write-Host ""
Write-Host "[2/3] Configuration du réseau pour Expo Go..." -ForegroundColor Yellow
$localIp = "localhost"

try {
    $ipAddresses = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object {
        $_.InterfaceAlias -notmatch 'Loopback|vEthernet|WSL|Default Switch|Virtual|Bluetooth' -and 
        $_.IPAddress -notmatch '^127\.|^169\.254\.'
    }
    if ($ipAddresses) {
        $firstIp = $ipAddresses | Select-Object -First 1
        if ($firstIp -and $firstIp.IPAddress) {
            $localIp = $firstIp.IPAddress
        }
    }
} catch {
    $null = $_
}

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
        Set-Content -Path $frontendEnv -Value $content -Encoding UTF8
    } else {
        Set-Content -Path $frontendEnv -Value "$backendUrlLine`r`n" -Encoding UTF8
    }
    Write-Host " ✔ Fichier frontend/.env configuré automatiquement." -ForegroundColor Green
}

# 3. Préparation & Démarrage du Backend
Write-Host ""
Write-Host "[3/3] Démarrage du Backend FastAPI..." -ForegroundColor Yellow

$pythonCmd = "python"
if (-not (Get-Command "python" -ErrorAction SilentlyContinue)) {
    if (Get-Command "py" -ErrorAction SilentlyContinue) {
        $pythonCmd = "py"
    } elseif (Get-Command "python3" -ErrorAction SilentlyContinue) {
        $pythonCmd = "python3"
    }
}

$venvDir = Join-Path $backendDir "venv"
$venvPython = Join-Path $venvDir "Scripts\python.exe"

if (-not (Test-Path $venvPython)) {
    Write-Host " ℹ Création de l'environnement virtuel Python (backend/venv)..." -ForegroundColor Cyan
    & $pythonCmd -m venv $venvDir
    Write-Host " ℹ Installation des dépendances Python..." -ForegroundColor Cyan
    & $venvPython -m pip install --upgrade pip
    & $venvPython -m pip install -r (Join-Path $backendDir "requirements.txt")
}

# Démarrage du processus backend
$backendProc = Start-Process -FilePath $venvPython -ArgumentList "-m uvicorn server:app --host 0.0.0.0 --port 8000 --reload" -WorkingDirectory $backendDir -PassThru -NoNewWindow
Write-Host " ✔ Backend démarré (PID: $($backendProc.Id)) sur http://localhost:8000" -ForegroundColor Green
Write-Host " ✔ Documentation Swagger : http://localhost:8000/docs" -ForegroundColor DarkCyan

# 4. Installation des dépendances Frontend si nécessaire
if (-not (Test-Path (Join-Path $frontendDir "node_modules"))) {
    Write-Host ""
    Write-Host " ℹ Installation des dépendances NPM / Expo..." -ForegroundColor Cyan
    Set-Location $frontendDir
    if (Get-Command yarn -ErrorAction SilentlyContinue) {
        yarn install
    } else {
        npm install
    }
    Set-Location $rootDir
}

# 5. Lancement d'Expo au premier plan
Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "🚀 Lancement du serveur Expo" -ForegroundColor Green
Write-Host "📱 Scannez le QR code avec l'application Expo Go" -ForegroundColor Green
Write-Host "🌐 Tapez 'w' dans la console pour ouvrir dans le navigateur" -ForegroundColor DarkCyan
Write-Host "🛑 Appuyez sur Ctrl+C pour TOUT arrêter proprement" -ForegroundColor DarkYellow
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""

# Vidage auto du cache Metro si frontend/.env a changé (les EXPO_PUBLIC_* sont inlinées au build).
$envHashFile = Join-Path $frontendDir ".env.metrohash"
$currentHash = (Get-FileHash $frontendEnv -Algorithm MD5).Hash
$storedHash = ""
if (Test-Path $envHashFile) { $storedHash = (Get-Content $envHashFile -Raw).Trim() }
$envChanged = ($currentHash -ne $storedHash)
if ($envChanged) {
    Write-Host " ℹ frontend/.env modifié : vidage du cache Metro (--clear)." -ForegroundColor Cyan
    Set-Content -Path $envHashFile -Value $currentHash -Encoding UTF8
}

try {
    Set-Location $frontendDir
    if ($envChanged) { npx expo start --clear } else { npx expo start }
} catch {
    Write-Host " Arrêt en cours..." -ForegroundColor Gray
} finally {
    Write-Host ""
    Write-Host "Arrêt du serveur Backend..." -ForegroundColor Yellow
    if ($backendProc -and -not $backendProc.HasExited) {
        Stop-Process -Id $backendProc.Id -Force -ErrorAction SilentlyContinue
    }
    Set-Location $rootDir
    Write-Host "✔ Tous les services ont été arrêtés proprement. À bientôt !" -ForegroundColor Green
}

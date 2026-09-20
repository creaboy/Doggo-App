# ==========================================================
# Doggo App - Script de demarrage tout-en-un (PowerShell)
# Compatible Windows PowerShell 5.1 & PowerShell Core 7+
# NOTE: ce fichier est volontairement en ASCII pur (pas d'accents
# ni d'emoji) pour eviter les erreurs de parsing dues a l'encodage
# ANSI de Windows PowerShell 5.1.
# ==========================================================

$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Demarrage de Doggo App (All-In-One)" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

$rootDir = $PSScriptRoot
if (-not $rootDir) { $rootDir = (Get-Location).Path }
$backendDir = Join-Path $rootDir "backend"
$frontendDir = Join-Path $rootDir "frontend"

# 1. Verification / Lancement de MongoDB
Write-Host "[1/3] Verification de MongoDB..." -ForegroundColor Yellow
$mongoRunning = $false

try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $tcp.Connect("127.0.0.1", 27017)
    $tcp.Close()
    $mongoRunning = $true
    Write-Host " [OK] MongoDB est deja actif sur le port 27017." -ForegroundColor Green
} catch {
    $null = $_
}

if (-not $mongoRunning) {
    if (Get-Command docker -ErrorAction SilentlyContinue) {
        Write-Host " [i] Demarrage de MongoDB via Docker Compose..." -ForegroundColor Cyan
        try {
            docker compose up -d mongodb
            Start-Sleep -Seconds 2
            Write-Host " [OK] MongoDB demarre dans Docker." -ForegroundColor Green
            $mongoRunning = $true
        } catch {
            Write-Host " [!] Erreur lors du lancement de Docker compose." -ForegroundColor Red
        }
    } else {
        Write-Host " [!] MongoDB n'est pas detecte sur le port 27017 et Docker n'a pas ete trouve." -ForegroundColor DarkYellow
        # Tente de demarrer un mongod local (installation Windows classique).
        $mongod = $null
        if (Get-Command mongod -ErrorAction SilentlyContinue) { $mongod = (Get-Command mongod).Source }
        else {
            $candidates = @(
                "C:\Program Files\MongoDB\Server\*\bin\mongod.exe",
                "C:\Program Files\MongoDB\bin\mongod.exe",
                "C:\MongoDB\bin\mongod.exe",
                "D:\MongoDB\bin\mongod.exe",
                "D:\MongoDB\Server\*\bin\mongod.exe"
            )
            foreach ($c in $candidates) {
                $found = Get-Item $c -ErrorAction SilentlyContinue | Select-Object -First 1
                if ($found) { $mongod = $found.FullName; break }
            }
        }
        $dbpath = if ($env:MONGO_DBPATH) { $env:MONGO_DBPATH } elseif (Test-Path "D:\MongoDB\data") { "D:\MongoDB\data" } else { Join-Path $backendDir "data\db" }
        if ($mongod) {
            Write-Host " [i] Demarrage de mongod local : $mongod (dbpath: $dbpath)" -ForegroundColor Cyan
            if (-not (Test-Path $dbpath)) { New-Item -ItemType Directory -Path $dbpath -Force | Out-Null }
            Start-Process -FilePath $mongod -ArgumentList "--dbpath `"$dbpath`" --bind_ip 127.0.0.1 --port 27017" -WindowStyle Hidden
            Start-Sleep -Seconds 3
            try {
                $t2 = New-Object System.Net.Sockets.TcpClient
                $t2.Connect("127.0.0.1", 27017); $t2.Close()
                $mongoRunning = $true
                Write-Host " [OK] MongoDB local demarre." -ForegroundColor Green
            } catch { $null = $_ }
        }
        if (-not $mongoRunning) {
            Write-Host "   Impossible de demarrer MongoDB automatiquement. Demarrez le service MongoDB puis relancez ce script." -ForegroundColor DarkGray
        }
    }
}

# 2. Detection de l'IP locale pour Expo Go
Write-Host ""
Write-Host "[2/3] Configuration du reseau pour Expo Go..." -ForegroundColor Yellow
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

Write-Host " [OK] IP locale detectee : $localIp" -ForegroundColor Green
Write-Host " [OK] URL de l'API Backend : http://${localIp}:8000" -ForegroundColor Green

# Creation / Mise a jour de frontend/.env
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
    Write-Host " [OK] Fichier frontend/.env configure automatiquement." -ForegroundColor Green
}

# 3. Preparation & Demarrage du Backend
Write-Host ""
Write-Host "[3/3] Demarrage du Backend FastAPI..." -ForegroundColor Yellow

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
    Write-Host " [i] Creation de l'environnement virtuel Python (backend/venv)..." -ForegroundColor Cyan
    & $pythonCmd -m venv $venvDir
    Write-Host " [i] Installation des dependances Python..." -ForegroundColor Cyan
    & $venvPython -m pip install --upgrade pip
    & $venvPython -m pip install -r (Join-Path $backendDir "requirements.txt")
}

# Demarrage du processus backend
$backendProc = Start-Process -FilePath $venvPython -ArgumentList "-m uvicorn server:app --host 0.0.0.0 --port 8000 --reload" -WorkingDirectory $backendDir -PassThru -NoNewWindow
Write-Host " [OK] Backend demarre (PID: $($backendProc.Id)) sur http://localhost:8000" -ForegroundColor Green
Write-Host " [OK] Documentation Swagger : http://localhost:8000/docs" -ForegroundColor DarkCyan

# 4. Installation des dependances Frontend si necessaire
if (-not (Test-Path (Join-Path $frontendDir "node_modules"))) {
    Write-Host ""
    Write-Host " [i] Installation des dependances NPM / Expo..." -ForegroundColor Cyan
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
Write-Host "Lancement du serveur Expo" -ForegroundColor Green
Write-Host "Scannez le QR code avec l'application Expo Go" -ForegroundColor Green
Write-Host "Tapez 'w' dans la console pour ouvrir dans le navigateur" -ForegroundColor DarkCyan
Write-Host "Appuyez sur Ctrl+C pour TOUT arreter proprement" -ForegroundColor DarkYellow
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""

# Vidage auto du cache Metro si frontend/.env a change (les EXPO_PUBLIC_* sont inlinees au build).
$envHashFile = Join-Path $frontendDir ".env.metrohash"
$currentHash = (Get-FileHash $frontendEnv -Algorithm MD5).Hash
$storedHash = ""
if (Test-Path $envHashFile) { $storedHash = (Get-Content $envHashFile -Raw).Trim() }
$envChanged = ($currentHash -ne $storedHash)
if ($envChanged) {
    Write-Host " [i] frontend/.env modifie : vidage du cache Metro (--clear)." -ForegroundColor Cyan
    Set-Content -Path $envHashFile -Value $currentHash -Encoding UTF8
}

try {
    Set-Location $frontendDir
    if ($envChanged) { npx expo start --clear } else { npx expo start }
} catch {
    Write-Host " Arret en cours..." -ForegroundColor Gray
} finally {
    Write-Host ""
    Write-Host "Arret du serveur Backend..." -ForegroundColor Yellow
    if ($backendProc -and -not $backendProc.HasExited) {
        Stop-Process -Id $backendProc.Id -Force -ErrorAction SilentlyContinue
    }
    Set-Location $rootDir
    Write-Host "[OK] Tous les services ont ete arretes proprement. A bientot !" -ForegroundColor Green
}

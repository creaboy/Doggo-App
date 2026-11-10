param([switch]$ClearCache)

# ==========================================================
#  Doggo App - Script de demarrage tout-en-un (PowerShell)
# Compatible Windows PowerShell 5.1 & PowerShell Core 7+
# ==========================================================

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " Demarrage de Doggo App (All-In-One)" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

$rootDir = $PSScriptRoot
if (-not $rootDir) { $rootDir = (Get-Location).Path }
$backendDir = Join-Path $rootDir "backend"
$frontendDir = Join-Path $rootDir "frontend"

# Synchroniser les dependances avant de demarrer des services.
if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "Node.js et npm sont requis. Installez Node.js 24 LTS puis relancez ce script."
}
& node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major >= 26 || major === 24 && minor >= 3 || major === 22 && minor >= 13 ? 0 : 1)"
if ($LASTEXITCODE -ne 0) { throw "Expo SDK 58 requiert Node.js 22.13+, 24.3+ ou 26+. Installez Node.js 24 LTS." }

$expoManifest = Join-Path $frontendDir "node_modules/expo/package.json"
$previousExpo = if (Test-Path -LiteralPath $expoManifest) { (Get-Content -LiteralPath $expoManifest -Raw | ConvertFrom-Json).version } else { "" }
function Get-FrontendDependencyHash {
    (@("package.json", "package-lock.json") | ForEach-Object {
        $dependencyFile = Join-Path $frontendDir $_
        if (Test-Path -LiteralPath $dependencyFile) { (Get-FileHash -LiteralPath $dependencyFile -Algorithm SHA256).Hash }
    }) -join ":"
}
$dependencyStamp = Join-Path $frontendDir "node_modules/.doggo-dependencies.sha256"
$dependencyHash = Get-FrontendDependencyHash
$needsInstall = -not (Test-Path -LiteralPath $dependencyStamp) -or -not (Test-Path -LiteralPath $expoManifest)
if (-not $needsInstall) { $needsInstall = (Get-Content -LiteralPath $dependencyStamp -Raw).Trim() -ne $dependencyHash }
if ($needsInstall) {
    Write-Host "Mise a jour des dependances du projet..." -ForegroundColor Yellow
    Push-Location $frontendDir
    try {
        if (Test-Path -LiteralPath (Join-Path $frontendDir "package-lock.json")) {
            & npm ci --no-audit --no-fund
        } else {
            & npm install --no-audit --no-fund
        }
        if ($LASTEXITCODE -ne 0) { throw "Installation npm echouee. Le serveur n'a pas ete demarre." }
        Set-Content -LiteralPath $dependencyStamp -Value (Get-FrontendDependencyHash) -Encoding ASCII
    } finally { Pop-Location }
}
$installedExpo = (Get-Content -LiteralPath $expoManifest -Raw | ConvertFrom-Json).version
$sdkChanged = $previousExpo -ne $installedExpo
Write-Host "Expo installe : $installedExpo (SDK $($installedExpo.Split('.')[0])) - cible Expo Go" -ForegroundColor Green

# 1. Verification / Lancement de MongoDB
Write-Host "[1/3] Verification de MongoDB..." -ForegroundColor Yellow
$mongoRunning = $false

try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $tcp.Connect("127.0.0.1", 27017)
    $tcp.Close()
    $mongoRunning = $true
    Write-Host " MongoDB est deja actif sur le port 27017." -ForegroundColor Green
} catch {
    $null = $_
}

if (-not $mongoRunning) {
    if (Get-Command docker -ErrorAction SilentlyContinue) {
        Write-Host " i Demarrage de MongoDB via Docker Compose..." -ForegroundColor Cyan
        try {
            docker compose up -d mongodb
            if ($LASTEXITCODE -ne 0) { throw "Docker Compose a echoue." }
            Start-Sleep -Seconds 2
            Write-Host " MongoDB demarre dans Docker." -ForegroundColor Green
            $mongoRunning = $true
        } catch {
            Write-Host " Erreur lors du lancement de Docker compose." -ForegroundColor Red
        }
    } else {
        Write-Host " MongoDB n'est pas detecte sur le port 27017 et Docker n'a pas ete trouve." -ForegroundColor DarkYellow
        Write-Host "  Si vous utilisez MongoDB installe en local, assurez-vous que le service MongoDB tourne." -ForegroundColor DarkGray
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

Write-Host " IP locale detectee : $localIp" -ForegroundColor Green
Write-Host " URL de l'API Backend : http://${localIp}:8000" -ForegroundColor Green

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
    Write-Host " Fichier frontend/.env configure automatiquement." -ForegroundColor Green
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
    Write-Host " i Creation de l'environnement virtuel Python (backend/venv)..." -ForegroundColor Cyan
    & $pythonCmd -m venv $venvDir
    if ($LASTEXITCODE -ne 0) { throw "Creation de l'environnement Python echouee." }
    Write-Host " i Installation des dependances Python..." -ForegroundColor Cyan
    & $venvPython -m pip install --upgrade pip
    & $venvPython -m pip install -r (Join-Path $backendDir "requirements.txt")
    if ($LASTEXITCODE -ne 0) { throw "Installation des dependances Python echouee." }
}

# Demarrage du processus backend
$backendProc = Start-Process -FilePath $venvPython -ArgumentList "-m uvicorn server:app --host 0.0.0.0 --port 8000 --reload" -WorkingDirectory $backendDir -PassThru -WindowStyle Hidden
Write-Host " Backend demarre (PID: $($backendProc.Id)) sur http://localhost:8000" -ForegroundColor Green
Write-Host " Documentation Swagger : http://localhost:8000/docs" -ForegroundColor DarkCyan

# 5. Lancement d'Expo au premier plan
Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host " Lancement du serveur Expo" -ForegroundColor Green
Write-Host " Scannez le QR code avec l'application Expo Go" -ForegroundColor Green
Write-Host " Tapez 'w' dans la console pour ouvrir dans le navigateur" -ForegroundColor DarkCyan
Write-Host " Appuyez sur Ctrl+C pour TOUT arreter proprement" -ForegroundColor DarkYellow
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""

try {
    Set-Location $frontendDir
    $expoArgs = @("start", "--go")
    if ($ClearCache -or $sdkChanged) { $expoArgs += "--clear" }
    & npx --no-install expo @expoArgs
    if ($LASTEXITCODE -ne 0) { throw "Expo s'est arrete avec le code $LASTEXITCODE." }
} finally {
    Write-Host ""
    Write-Host "Arret du serveur Backend..." -ForegroundColor Yellow
    if ($backendProc -and -not $backendProc.HasExited) {
        Stop-Process -Id $backendProc.Id -Force -ErrorAction SilentlyContinue
    }
    Set-Location $rootDir
    Write-Host " Tous les services ont ete arretes proprement. A bientot !" -ForegroundColor Green
}

#!/usr/bin/env bash
# ==========================================================
# 🐾 Doggo App - Script de démarrage tout-en-un (Bash)
# ==========================================================

set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

echo -e "\n\033[1;36m==========================================\033[0m"
echo -e "\033[1;36m🐾 Démarrage de Doggo App (All-In-One)\033[0m"
echo -e "\033[1;36m==========================================\n\033[0m"

# 1. MongoDB
echo -e "\033[1;33m[1/3] Vérification de MongoDB...\033[0m"
if nc -z 127.0.0.1 27017 2>/dev/null || timeout 1 bash -c 'cat < /dev/null > /dev/tcp/127.0.0.1/27017' 2>/dev/null; then
    echo -e "\033[1;32m ✔ MongoDB est déjà actif sur le port 27017.\033[0m"
elif command -v docker >/dev/null 2>&1; then
    echo -e "\033[1;36m ℹ Démarrage de MongoDB via Docker Compose...\033[0m"
    docker compose up -d mongodb
    sleep 2
    echo -e "\033[1;32m ✔ MongoDB démarré dans Docker.\033[0m"
else
    echo -e "\033[1;33m ⚠ MongoDB non détecté sur le port 27017. Assurez-vous qu'il est lancé.\033[0m"
fi

# 2. Détection IP locale
echo -e "\n\033[1;33m[2/3] Configuration du réseau pour Expo Go...\033[0m"
LOCAL_IP=$(ip route get 1.1.1.1 2>/dev/null | awk '{print $7}' | head -n1 || hostname -I 2>/dev/null | awk '{print $1}')
if [ -z "$LOCAL_IP" ]; then
    LOCAL_IP="localhost"
fi
echo -e "\033[1;32m ✔ IP locale détectée : $LOCAL_IP\033[0m"
echo -e "\033[1;32m ✔ URL de l'API Backend : http://$LOCAL_IP:8000\033[0m"

if [ ! -f "$FRONTEND_DIR/.env" ]; then
    if [ -f "$FRONTEND_DIR/.env.example" ]; then
        sed "s|EXPO_PUBLIC_BACKEND_URL=.*|EXPO_PUBLIC_BACKEND_URL=http://$LOCAL_IP:8000|" "$FRONTEND_DIR/.env.example" > "$FRONTEND_DIR/.env"
    else
        echo "EXPO_PUBLIC_BACKEND_URL=http://$LOCAL_IP:8000" > "$FRONTEND_DIR/.env"
    fi
    echo -e "\033[1;32m ✔ Fichier frontend/.env configuré avec l'IP $LOCAL_IP\033[0m"
fi

# 3. Backend Python
echo -e "\n\033[1;33m[3/3] Démarrage du Backend FastAPI...\033[0m"
if [ ! -d "$BACKEND_DIR/venv" ]; then
    echo -e "\033[1;36m ℹ Création du venv Python...\033[0m"
    python3 -m venv "$BACKEND_DIR/venv"
    "$BACKEND_DIR/venv/bin/pip" install --upgrade pip
    "$BACKEND_DIR/venv/bin/pip" install -r "$BACKEND_DIR/requirements.txt"
fi

"$BACKEND_DIR/venv/bin/python" -m uvicorn server:app --host 0.0.0.0 --port 8000 --reload --app-dir "$BACKEND_DIR" &
BACKEND_PID=$!

cleanup() {
    echo -e "\n\033[1;33mArrêt des services...\033[0m"
    if kill -0 "$BACKEND_PID" 2>/dev/null; then
        kill "$BACKEND_PID" 2>/dev/null || true
    fi
    echo -e "\033[1;32m✔ Tous les services sont arrêtés. À bientôt !\033[0m"
}
trap cleanup EXIT INT TERM

# 4. Frontend
if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
    echo -e "\n\033[1;36m ℹ Installation des dépendances NPM / Expo...\033[0m"
    cd "$FRONTEND_DIR"
    if command -v yarn >/dev/null 2>&1; then yarn install; else npm install; fi
fi

echo -e "\n\033[1;32m==========================================\033[0m"
echo -e "\033[1;32m🚀 Lancement du serveur Expo\033[0m"
echo -e "\033[1;32m📱 Scannez le QR code avec Expo Go\033[0m"
echo -e "\033[1;36m🌐 Tapez 'w' dans la console pour ouvrir le Web\033[0m"
echo -e "\033[1;33m🛑 Appuyez sur Ctrl+C pour TOUT arrêter\033[0m"
echo -e "\033[1;32m==========================================\n\033[0m"

cd "$FRONTEND_DIR"
npx expo start

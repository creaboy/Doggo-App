# 🐾 Doggo App

Application mobile et web pour découvrir, tracer et partager des balades adaptées aux chiens (liberté sans laisse, points d'eau, alertes et dangers, tracés GPS, etc.).

L'application est construite avec :
- **Backend :** Python FastAPI + Motor (MongoDB asynchrone) + OSRM (routage piéton OpenStreetMap)
- **Frontend :** React Native / Expo (compatible Web, iOS et Android via Expo Go)
- **Base de données :** MongoDB

---

## ⚡ Démarrage en 1 seule commande (Recommandé)

### Sur Windows (PowerShell) :
Exécutez simplement :
```powershell
.\start-dev.ps1
```
*(ou double-cliquez sur `start-dev.bat`)*

### Sur macOS / Linux / Git Bash :
```bash
./start-dev.sh
```

**Ce script s'occupe de tout automatiquement :**
1. Démarre MongoDB (via Docker ou détecte votre instance locale).
2. Détecte automatiquement l'adresse IP locale de votre machine sur le réseau Wi-Fi.
3. Configure `frontend/.env` avec la bonne URL de l'API pour que votre téléphone puisse s'y connecter avec Expo Go.
4. Lance le backend FastAPI en arrière-plan.
5. Lance le serveur Expo au premier plan (vous pouvez scanner le QR code directement sur votre téléphone ou taper `w` pour tester sur votre navigateur web).
6. Arrête tous les services proprement lorsque vous faites `Ctrl+C`.

---

## 🚀 Démarrage manuel (étape par étape)

### Prérequis
- **Node.js** (v18+) et **Yarn** ou **npm**
- **Python** (v3.10+) et **pip**
- **MongoDB** (installé localement ou via Docker)
- Application **Expo Go** installée sur votre smartphone (disponible sur l'App Store / Google Play) si vous souhaitez tester sur mobile.

---

### 1. Démarrer la base de données (MongoDB)

Si vous avez Docker installé, lancez simplement :
```bash
docker compose up -d
```
Cela démarrera une instance MongoDB accessible sur `mongodb://localhost:27017`.

*(Si vous avez déjà MongoDB installé en local ou sur MongoDB Atlas, vous pouvez directement utiliser votre URI).*

---

### 2. Démarrer le Backend (FastAPI)

1. Rendez-vous dans le dossier `backend` :
   ```bash
   cd backend
   ```

2. Créez un environnement virtuel Python et activez-le :
   ```bash
   python -m venv venv
   source venv/bin/activate  # Sur Windows : venv\Scripts\activate
   ```

3. Installez les dépendances :
   ```bash
   pip install -r requirements.txt
   ```

4. *(Optionnel)* Créez votre fichier `.env` si besoin (un fichier `.env.example` est fourni) :
   ```bash
   cp .env.example .env
   ```

5. Lancez le serveur FastAPI :
   ```bash
   uvicorn server:app --reload --host 0.0.0.0 --port 8000
   ```
   *L'API est accessible sur `http://localhost:8000`. La documentation interactive Swagger est disponible sur `http://localhost:8000/docs`.*

---

### 3. Démarrer le Frontend (Expo)

1. Dans un autre terminal, rendez-vous dans le dossier `frontend` :
   ```bash
   cd frontend
   ```

2. Installez les dépendances :
   ```bash
   yarn install
   # ou : npm install
   ```

3. Configurez les variables d'environnement dans un fichier `.env` :
   ```bash
   cp .env.example .env
   ```

   **Important pour tester avec Expo Go sur mobile :**
   - Ouvrez `frontend/.env` et remplacez `localhost` par l'adresse IP locale de votre ordinateur sur votre réseau Wi-Fi (ex: `http://192.168.1.50:8000`).
   - Assurez-vous que votre smartphone et votre ordinateur sont connectés au **même réseau Wi-Fi**.

4. Lancez le serveur Expo :
   ```bash
   npx expo start
   ```

5. **Tester :**
   - **Sur votre téléphone :** Scannez le QR Code affiché dans le terminal avec l'application **Expo Go** (Android) ou l'appareil photo (iOS).
   - **Sur le Web :** Appuyez sur `w` dans le terminal pour ouvrir la version web dans votre navigateur (`http://localhost:8081`).
   - **Sur émulateur :** Appuyez sur `a` (Android Emulator) ou `i` (iOS Simulator).

---

## 🔑 Compte de démonstration

Au premier démarrage du backend, des balades de test et un compte démo sont automatiquement créés :
- **Email :** `demo@doggo.app`
- **Mot de passe :** `demo1234`

Vous pouvez également créer un nouveau compte directement depuis l'écran de connexion ("Create account").

---

## 🗺️ Cartographie et Routage

### Fond de carte par défaut : vectoriel « façon Google Maps », sans clé

Sur iOS, Android et Web, la carte est rendue avec **MapLibre GL** + **OpenFreeMap**
(style **« Liberty »**, dérivé d'osm-bright) : fond gris très clair, routes blanches
liserées de gris, autoroutes jaunes, parcs verts pâles, eau bleue, icônes de commerces /
POI colorées et libellés de quartiers — le rendu le plus proche de Google Maps, **sans
compte, sans clé, sans facturation**, usage commercial autorisé.

- **Zoom continu et fluide** (pinch sans paliers, inertie de déplacement), tuiles
  vectorielles nettes à tous les niveaux de zoom.
- **Repli automatique sur Leaflet / tuiles OpenStreetMap** si l'appareil n'a pas WebGL.
- Si aucune clé Google Maps n'est configurée, l'application n'essaie même pas de charger
  Google Maps : la carte s'affiche tout de suite.

Variantes (dans `frontend/.env`, puis relancer avec `npx expo start -c`) :

```bash
# Style ultra-épuré (masque une partie des commerces) :
EXPO_PUBLIC_MAP_STYLE=positron

# Ou style vectoriel CARTO Voyager avec une clé gratuite (https://carto.com/basemaps/apikey) :
EXPO_PUBLIC_CARTO_API_KEY=votre_cle_carto

# Ou n'importe quel style MapLibre (URL style.json) :
EXPO_PUBLIC_MAP_STYLE_URL=https://exemple.org/style.json
```

### Routage

- **Routage et accrochage de parcours (Snap) :** Les calculs d'itinéraires piétons utilisent le moteur OSRM public d'OpenStreetMap.

### Google Maps (100 % optionnel)

Si vous possédez un projet Google Cloud avec l'API Maps activée, renseignez :

| Variable | Fichier | Rôle |
| --- | --- | --- |
| `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY` | `frontend/.env` | SDK natif Android (nécessite un *development build*, pas Expo Go) |
| `EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY` | `frontend/.env` | SDK natif iOS (nécessite un *development build*, pas Expo Go) |
| `EXPO_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` | `frontend/.env` | Carte Google Maps JS affichée dans la WebView (Expo Go compris) |
| `GOOGLE_MAPS_BROWSER_KEY` | `backend/.env` | Même clé « Browser », injectée par le backend dans `/api/maps/view` |

Tant que ces variables sont vides, OpenStreetMap est utilisé. La bascule vers OpenStreetMap
reste automatique si Google Maps ne répond pas (clé invalide, facturation coupée, réseau).

---

## 📂 Structure du projet

```
Doggo-App/
├── backend/                  # API Backend (FastAPI + MongoDB)
│   ├── server.py             # Points d'API REST (Auth, Balades, Avis, POIs, Dangers)
│   ├── route_geometry.py     # Algorithmes de géométrie et calculs de distance
│   ├── walking_routing.py    # Routage piéton et accrochage GPS (OSRM)
│   └── requirements.txt      # Dépendances Python
├── frontend/                 # Application mobile & web (React Native / Expo)
│   ├── app/                  # Routes et écrans (Expo Router)
│   │   ├── (tabs)/           # Onglets principaux (Explorer, Créer, Favoris, Profil)
│   │   ├── auth/             # Écran d'authentification (Connexion / Inscription)
│   │   └── walk/[id].tsx     # Fiche détaillée d'une balade
│   ├── src/                  # Composants, Hooks et Contexte
│   │   ├── AuthContext.tsx   # Gestion de la session utilisateur
│   │   ├── DoggoMap.tsx      # Composant carte interactif (Leaflet / OpenStreetMap)
│   │   ├── GoogleDoggoMap.tsx # Utilise Google Maps uniquement si une clé est configurée
│   │   ├── tileSource.ts     # Choix du style vectoriel (OpenFreeMap/CARTO/personnalisé)
│   │   ├── useRouteRecorder.ts # Enregistrement GPS en direct
│   │   └── api.ts            # Client HTTP API
│   ├── app.json              # Configuration Expo (Nom, Bundle ID, Permissions)
│   └── package.json          # Dépendances NPM
├── docker-compose.yml        # Déploiement MongoDB en local
└── README.md
```

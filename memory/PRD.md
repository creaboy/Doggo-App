# Doggo — PRD

## Vision
A "Waze for dog walks" — a mobile-first community app to discover, share and keep up to date dog-friendly walking routes.

## MVP Scope (Delivered)
- **Explore (map + list)** — react-native-maps on native, SVG fallback on web. Filter by environment, difficulty, dog freedom, max duration, min rating. Chip row + filter sheet.
- **Walk detail** — color-coded route segments (green=off-leash, orange=caution, red=leash), POIs, hazards, ratings 1–5, comments, community confirmation UI ("Last verified Xd ago" + confirmations in last 30 days).
- **Create walk** — draw route by tapping map OR live GPS recording (native). Segment freedom selector. Auto-computed distance & off-leash %.
- **Community** — rate, comment, confirm walk accuracy, report changes (new hazard, path closed, etc.), confirm/resolve individual hazards.
- **Auth** — email/password + Emergent Google Auth. Guest browsing available.
- **Profile** — user's walks, stats, recent comments, logout.

## Data model (Mongo)
User, Walk (with `segments[]` incl. per-segment freedom), PointOfInterest, Hazard (with `confirmations`, `last_confirmed_at`, `expires_at` field ready for auto-expiry), Rating, Comment, WalkConfirmation.

## Seed
4 realistic walks around France (Fontainebleau forest, Vexin countryside, Parc Montsouris Paris, Quiberon coast) with POIs, hazards, ratings, comments.

## Tech
- Expo Router (React Native 0.86, Expo 57)
- FastAPI + Motor/MongoDB
- Phosphor icons, react-native-maps, expo-location, react-native-svg

## Out of scope (per brief)
Subscriptions, payments, messaging, followers, feed, badges, dog profiles, veterinary, marketplace, events, groups.

## Smart enhancement
The hazard confirmations + `expires_at` model creates a self-healing community layer: fresh hazards stay visible, stale ones fade — the loop that drives repeat engagement.

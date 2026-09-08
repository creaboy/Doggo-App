# Doggo — produit et état technique

## Demande
Application mobile communautaire de balades canines. Itération ciblée sur la création de boucles et l’UX carte, sans refonte ni perte des données/API/fonctionnalités existantes. Communication utilisateur en français.

## Architecture actuelle
- Expo Router, Expo 57.0.19 / React Native 0.86.3 (versions existantes conservées), FastAPI, MongoDB/Motor.
- Auth email + Google Emergent inchangée. Comptes de test : `memory/test_credentials.md`.
- `DoggoMap` conserve son contrat. Google Maps JavaScript dans `/api/maps/view` HTTPS via WebView (Expo Go) / iframe (aperçu). `react-native-maps` Google pour un binaire natif configuré ; fallback Leaflet/CARTO explicite si erreur Google.
- Clé Google de test fournie par l’utilisateur dans `.env.local` ignorés, pas dans les sources. Même clé temporaire autorisée par l’utilisateur ; à remplacer/restrindre. Variables de framework inchangées. `app.config.js` étend `app.json`, pas de remplacement.
- `/api/routing/snap` conserve points `[[lat,lng]]`, profil, coordonnées, distance/durée. Routage désormais réellement piéton : instance FOSSGIS `routed-foot`, limite globale 1 requête/seconde (serveur à un worker), lots de 25 points, connecteurs terminaux <=20m. Pas de fallback voiture.
- Google fournit uniquement le fond de carte : pas de stockage permanent de géométrie Google Routes. Tracés utilisateur/OSM durables compatibles avec la base existante, attribution affichée.

## Fonctionnalités existantes conservées
Explorer carte/liste, filtres/recherche, favoris, alertes proches, récapitulatif hebdomadaire, partage, profil, détails de balade, notes/commentaires, confirmations, dangers, POI. Anciennes balades et version de seed inchangées, y compris les anciennes routes ouvertes ; aucune migration destructive.

## Itération boucles — implémentée et vérifiée en automatisation
- `routeDraft.ts` : premier point officiel immuable, segments et statistiques géodésiques, fermeture exacte, itinéraires longs sans spread de tableaux dans Math.min/max.
- `useWalkCreation.ts` : dessin par ajouts annulables et immédiatement ajustés, fermeture via chemins piétons, reset, liberté individuelle et des prochains segments. Aucun recalcul après publication.
- `useRouteRecorder.ts` : GPS de premier plan, contrôle permission/précision/sauts/points doublons, cleanup abonnement. Aucun test de proximité ne provoque d’arrêt.
- Stop explicite : <=20m ferme le petit écart sans détour ; >20m propose retour piéton / continuer / annuler et reprendre. Erreur de calcul : données conservées et publication bloquée.
- Déplacement minimum exploitable : longueur >=20m et éloignement du départ >=10m (rejette démarrage immobile).
- Retour généré ajouté en segment prudence, pointillés dans l’aperçu ; liberté de chaque segment modifiable dans l’aperçu.
- Aperçu obligatoire avec carte cadrée sur toute la boucle, départ/arrivée, distance et pourcentage libre finaux, durée saisie. Aucun nouvel ajustement après validation.
- `/api/walks` contrôle toute nouvelle route : coordonnées valides, segments continus, non-dégénérescence, départ/arrivée identiques. Schéma compatible, données historiques intactes.
- Style Google neutre, entreprises et établissements visibles, superpositions Doggo prioritaires ; attribution Google conservée.

## Vérifications déjà faites
- TypeScript : compilation sans erreur après corrections de types mineures préexistantes.
- Python : lint sans erreur.
- Aperçu : login démo, carte Google Explorer avec tuiles réelles, écran création chargé. Erreur initiale postMessage (fonctions marqueurs) corrigée, vérification visuelle réussie.
- API accessible ; contrôle d’un point situé hors du réseau piéton renvoie une erreur explicite plutôt qu’un raccourci trompeur.

## Complément utilisateur — ajustement continu et découpage (20 secondes confirmé)
- Chaque point manuel crée immédiatement un segment ajusté aux chemins. Échec explicite, point conservé, reprise via « Suivre les chemins » ; pas de publication de segment non ajusté.
- Recalage GPS toutes les **20 secondes** sur les seules nouvelles fenêtres de points bruts ; `/api/routing/match` dédié OSRM piéton (endpoint Match testé réellement, réponse Ok). Pas de routage direct entre départ et fin qui couperait les boucles.
- Points GPS originaux, précision et horodatage conservés séparément de la géométrie ajustée dans le brouillon (`rawGps` / `gpsSamples`). Seuil Stop calculé sur positions GPS brutes, jamais sur positions déplacées par le recalage.
- Matching sérialisé, suffixe reçu pendant la requête préservé, reprise en cas d’échec, jonctions entre fenêtres sur le chemin, nettoyage timer au Stop. Dernière fenêtre traitée avant aperçu, pas après publication.
- Chaque segment est cliquable dans la carte de création et d’aperçu (Google/Leaflet/native), surbrillance et choix Sans laisse / En laisse / Attention.
- Bouton « Diviser à cet endroit » après toucher de la polyligne : projection sur l’arête, deux portions indépendantes, mêmes coordonnées de jonction, couleurs et longueur conservées ; annulation possible. Découpage GPS une fois l’enregistrement terminé.
- Seuil 20 m : tolérance numérique d’un micromètre seulement ; distances >20m affichées sans arrondi trompeur à20m.
- RCA de l’aperçu intermittent : test forçait le bouton désactivé pendant calcul. Attendre disparition `route-busy`/bouton activé (pas de `force=True`). Feedback ajouté si action tentée pendant travail.
- Vérification intermédiaire : TypeScript/lints sans erreurs, vrai snap manuel HTTP200 + sélection carte et changement En laisse vérifiés en capture.
- Validation navigateur du 8 septembre (160657) : ajustement immédiat des 2 segments, découpage/annulation création, découpage/édition aperçu, publication d’une boucle continue exacte à4segments ; aucun routage après publication. Largeur réelle html/body/root de320px : pas de débordement (ancienne alerte était un descendant de carrousel).
- Validation GPS contrôlé navigateur (160914), APIs réelles : requête MATCH à20,07s ; positions brutes conservées ; annulerfin à46m reprend ; arrêt~19m complète la dernière fenêtre et ferme ; découpage du GPS, liberté indépendante ; publication puis absence de routage pendant21s. Pas de test physique Android/iOS.
- Erreurs routage désormais dans l’en-tête, visibles sans défiler ; segments en attente en pointillés orange. Attributs accessibles sur le canvas pour attendre son état réel sans forcer les contrôles désactivés.
- Tests ciblés backend MATCH/validation : **8/8** (`iteration_7.json`). Suite backend précédente :34/34 (`pytest_results.xml`).
- Tests déterministes TypeScript : **15/15** (`iteration_8.json`, `frontend/tests/pure_ts_modules_runner.cjs`). Seuils 5/19/20/20.1/21/500m, source GPS brute pour la distance, échecs sans mutation, géométries20k, découpage/interpolation/conservation des règles, remplacement d’une fenêtre pendant réception d’un suffixe, continuité, plusieurs passages au départ.
- Aucun défaut fonctionnel restant reproduit dans les contrôles réalisés. Les erreurs de saisie/hors réseau et indisponibilités externes restent signalées, avec données du brouillon préservées et publication bloquée si non ajustée/non fermée.
- Les deux balades créées par la vérification directe (titres TEST boucle segments validés et TEST GPS20s boucle divisée, Berlin) sont retirées après contrôle ; aucune autre balade ni donnée historique n’est supprimée.

## Priorités
### P0
- Aucun blocage connu après les vérifications ci-dessus. Les rapports6/7 conservent l’historique des essais inconclusifs, résolus par les vérifications directes160657/160914.
### P1
- Validation physique Android Expo Go et Android/iOS binaire natif Google ; non réalisable par le seul navigateur.
- Enregistrement GPS en arrière-plan : hors de cette itération, premier plan explicitement annoncé.
- Restreindre/remplacer la clé Maps de test ; configurations Google distinctes par plateforme recommandées.
### P2
- Expiration automatique des dangers temporaires.
- Photos (écartées du MVP par l’utilisateur).
- Pour un trafic élevé : remplacer le service public de routage par une instance piétonne dédiée et une limitation partagée si plusieurs workers.
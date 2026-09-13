/**
 * Fond de carte OpenStreetMap utilisé dès qu'aucune clé Google Maps n'est configurée.
 *
 * Aucun compte ni carte bancaire n'est nécessaire par défaut : on utilise les tuiles
 * officielles OpenStreetMap (gratuites, riches en commerces / POI).
 *
 * Deux options permettent d'obtenir un rendu plus épuré « façon Google Maps » :
 *  - `EXPO_PUBLIC_CARTO_API_KEY` : style CARTO Voyager (clé gratuite, sans compte,
 *    https://carto.com/basemaps/apikey — la clé évite le filigrane « API key required »).
 *  - `EXPO_PUBLIC_TILE_URL` : n'importe quel fournisseur de tuiles XYZ compatible Leaflet.
 *
 * Les variables sont lues par l'appelant (voir `tileEnv()` dans DoggoMap.tsx) afin que
 * Metro/Expo puisse les inliner au build (`process.env.EXPO_PUBLIC_*`), ce module reste
 * donc pur et testable.
 */

export type TileEnv = {
  url?: string | null;
  attribution?: string | null;
  subdomains?: string | null;
  credit?: string | null;
  cartoKey?: string | null;
};

export type TileSource = {
  name: 'openstreetmap' | 'carto-voyager' | 'custom';
  /** Texte court affiché sous la carte (pas d'HTML). */
  credit: string;
  /** Template de tuiles XYZ au format Leaflet (`{s}`/`{z}`/`{x}`/`{y}`). */
  url: string;
  /** Attribution HTML exigée par la licence des données. */
  attribution: string;
  subdomains: string;
  maxZoom: number;
  /** Vrai si le fond s'utilise sans aucune clé (affiché sous la carte). */
  keyless: boolean;
  /** Le fournisseur sert des tuiles @2x (template `{r}`) : rendu net sur écrans retina. */
  detectRetina: boolean;
};

const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const OPENSTREETMAP: TileSource = {
  name: 'openstreetmap',
  credit: 'OpenStreetMap',
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: OSM_ATTRIBUTION,
  subdomains: 'abc',
  maxZoom: 19,
  keyless: true,
  detectRetina: false,
};

const CARTO_ATTRIBUTION = `${OSM_ATTRIBUTION} &copy; <a href="https://carto.com/attributions">CARTO</a>`;

function clean(value?: string | null): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * User-Agent stable et identifiable, demandé par la Tile Usage Policy d'OpenStreetMap
 * pour les applications mobiles (https://operations.osmfoundation.org/policies/tiles/).
 */
export const TILE_USER_AGENT = 'DoggoApp/1.0 (balades pour chiens; +https://github.com/creaboy/Doggo-App)';

export function resolveTileSource(env: TileEnv = {}): TileSource {
  const url = clean(env.url);
  if (url) {
    return {
      name: 'custom',
      credit: clean(env.credit) || 'tuiles personnalisées',
      url,
      attribution: clean(env.attribution) || OSM_ATTRIBUTION,
      subdomains: clean(env.subdomains) || 'abc',
      maxZoom: 20,
      keyless: false,
      detectRetina: false,
    };
  }
  const cartoKey = clean(env.cartoKey);
  if (cartoKey) {
    return {
      name: 'carto-voyager',
      credit: 'CARTO Voyager · OpenStreetMap',
      url: `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(cartoKey)}`,
      attribution: CARTO_ATTRIBUTION,
      subdomains: 'abcd',
      maxZoom: 20,
      keyless: false,
      detectRetina: true,
    };
  }
  return OPENSTREETMAP;
}

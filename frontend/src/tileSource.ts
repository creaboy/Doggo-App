/**
 * Rendu de carte vectoriel (MapLibre GL), sans clé par défaut.
 *
 * Par défaut on utilise **OpenFreeMap** (style « Liberty », dérivé d'osm-bright) :
 * c'est le rendu le plus proche de Google Maps — fond clair, routes blanches,
 * parcs verts, eau bleue, icônes de commerces/POI colorées — et c'est gratuit,
 * sans compte ni clé, usage commercial autorisé, sans limite annoncée.
 *
 * Options :
 *  - `EXPO_PUBLIC_MAP_STYLE_URL` : n'importe quel style MapLibre (style.json).
 *  - `EXPO_PUBLIC_CARTO_API_KEY` : style vectoriel CARTO Voyager.
 *  - `EXPO_PUBLIC_MAP_STYLE=positron` : OpenFreeMap Positron (ultra-épuré, sans commerces).
 *
 * Les variables sont lues par l'appelant (voir `styleEnv()` dans DoggoMap.tsx) afin que
 * Metro/Expo les inline au build ; ce module reste donc pur et testable.
 */

export type StyleEnv = {
  styleUrl?: string | null;
  cartoKey?: string | null;
  style?: string | null;
};

export type MapStyleSource = {
  name: string;
  /** Texte court affiché sous la carte (pas d'HTML). */
  credit: string;
  /** URL d'un style MapLibre (style.json). */
  styleUrl: string;
  /** Vrai si aucun compte/clé n'est nécessaire. */
  keyless: boolean;
};

const OPENFREEMAP_LIBERTY: MapStyleSource = {
  name: 'openfreemap-liberty',
  credit: 'OpenFreeMap · OpenStreetMap',
  styleUrl: 'https://tiles.openfreemap.org/styles/liberty',
  keyless: true,
};

const OPENFREEMAP_POSITRON: MapStyleSource = {
  name: 'openfreemap-positron',
  credit: 'OpenFreeMap · OpenStreetMap',
  styleUrl: 'https://tiles.openfreemap.org/styles/positron',
  keyless: true,
};

function clean(value?: string | null): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * User-Agent stable et identifiable, demandé par la Tile Usage Policy d'OpenStreetMap
 * pour les applications mobiles (https://operations.osmfoundation.org/policies/tiles/).
 * Il est transmis à la WebView qui charge les tuiles.
 */
export const TILE_USER_AGENT = 'DoggoApp/1.0 (balades pour chiens; +https://github.com/creaboy/Doggo-App)';

export function resolveMapStyle(env: StyleEnv = {}): MapStyleSource {
  const styleUrl = clean(env.styleUrl);
  if (styleUrl) {
    return { name: 'custom', credit: 'style personnalisé', styleUrl, keyless: false };
  }
  const cartoKey = clean(env.cartoKey);
  if (cartoKey) {
    return {
      name: 'carto-voyager-vector',
      credit: 'CARTO Voyager · OpenStreetMap',
      styleUrl: `https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json?key=${encodeURIComponent(cartoKey)}`,
      keyless: false,
    };
  }
  if (clean(env.style) === 'positron') return OPENFREEMAP_POSITRON;
  return OPENFREEMAP_LIBERTY;
}

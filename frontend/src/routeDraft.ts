import type { LatLng, SegmentInput } from './DoggoMap';
export type Freedom = SegmentInput['freedom'];
export type GpsSample = LatLng & { timestamp: number; accuracy: number };
export type Leg = SegmentInput & { id?: string; source: 'draw' | 'gps' | 'return'; snapped?: boolean; sealed?: boolean; gpsSamples?: GpsSample[]; offRoute?: boolean };
export type Draft = { start: LatLng | null; legs: Leg[]; rawGps?: GpsSample[] };
let nextId = 0;
const sessionId = Date.now().toString(36);
export const legId = () => `leg-${sessionId}-${++nextId}`;
export const emptyDraft = (): Draft => ({ start: null, legs: [] });

export function meters(a: LatLng, b: LatLng) {
  const rad = Math.PI / 180;
  const h = Math.sin((b.latitude - a.latitude) * rad / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin((b.longitude - a.longitude) * rad / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(Math.min(1, h)), Math.sqrt(Math.max(0, 1 - h)));
}
export const lastPoint = (d: Draft) => d.legs.length ? d.legs[d.legs.length - 1].coordinates.at(-1)! : d.start;
export const gapToStart = (d: Draft) => d.start && lastPoint(d) ? meters(d.start, lastPoint(d)!) : 0;
// Micrometre tolerance only for floating-point math. 20.01m is STILL outside the threshold.
export const withinClosingDistance = (value: number) => value <= 20 + 0.000001;
export const rawGapToStart = (d: Draft) => d.start && d.rawGps?.length ? meters(d.start, d.rawGps.at(-1)!) : gapToStart(d);
export const closed = (d: Draft) => !!d.start && d.legs.length > 0 && gapToStart(d) < 0.001;
export const legDistance = (s: SegmentInput) => s.coordinates.reduce((n, p, i, a) => n + (i ? meters(a[i - 1], p) : 0), 0);
export const distance = (d: Draft) => d.legs.reduce((n, s) => n + legDistance(s), 0);
export function usable(d: Draft) {
  return !!d.start && distance(d) >= 20 && d.legs.some(s => s.coordinates.some(p => meters(d.start!, p) >= 10));
}
export function stats(d: Draft) {
  const total = distance(d);
  const free = d.legs.filter(s => s.freedom === 'free').reduce((n, s) => n + legDistance(s), 0);
  return { distanceKm: total / 1000, offLeashPct: total ? Math.round(100 * free / total) : 0 };
}
export function addPoint(d: Draft, p: LatLng, freedom: Freedom, source: 'draw' | 'gps'): Draft {
  const last = lastPoint(d);
  if (!last) return { start: p, legs: [] };
  if (meters(last, p) < 0.5) return d;
  const tail = d.legs.at(-1);
  // GPS samples merge within the current freedom segment. Manual taps remain undoable actions.
  if (source === 'gps' && tail?.source === 'gps' && tail.freedom === freedom) {
    return { ...d, legs: [...d.legs.slice(0, -1), { ...tail, coordinates: [...tail.coordinates, p] }] };
  }
  return { ...d, legs: [...d.legs, { id: legId(), coordinates: [last, p], freedom, source, snapped: false }] };
}
export function appendReturn(d: Draft, coordinates: LatLng[]): Draft {
  if (!d.start || !lastPoint(d)) throw new Error('Le point de départ est manquant.');
  const points = coordinates.filter((p, i) => !i || meters(coordinates[i - 1], p) > 0.001);
  if (points.length < 2) throw new Error('Le retour calculé est vide.');
  points[0] = lastPoint(d)!; points[points.length - 1] = d.start;
  return { ...d, legs: [...d.legs, { id: legId(), coordinates: points, freedom: 'caution', source: 'return', generated: true, snapped: true }] };
}
export function regionFor(d: Draft) {
  let south = Infinity, north = -Infinity, west = Infinity, east = -Infinity;
  for (const s of d.legs) for (const p of s.coordinates) {
    south = Math.min(south, p.latitude); north = Math.max(north, p.latitude);
    west = Math.min(west, p.longitude); east = Math.max(east, p.longitude);
  }
  if (!Number.isFinite(south)) return undefined;
  return { latitude: (north + south) / 2, longitude: (east + west) / 2,
    latitudeDelta: Math.max(.001, (north - south) * 1.5), longitudeDelta: Math.max(.001, (east - west) * 1.5) };
}
export const formatMeters = (value: number) => value > 20 && value < 21 ? `${(Math.ceil(value * 10) / 10).toFixed(1)} m` : value < 1000 ? `${Math.round(value)} m` : `${(value / 1000).toFixed(2)} km`;
export function routeMarkers(d: Draft) {
  if (!d.start) return [];
  const pts = [{ id: 'wp-1', coordinate: d.start, waypoint: 1, label: 'Départ' }];
  let n = 1;
  for (const leg of d.legs) {
    const end = leg.coordinates.at(-1);
    if (!end) continue;
    if (meters(end, d.start) < 0.001) continue; // boucle refermée : pas de doublon sur le départ
    n += 1;
    pts.push({ id: `wp-${n}`, coordinate: end, waypoint: n, label: `Point ${n}` });
  }
  return pts;
}
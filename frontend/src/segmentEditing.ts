import type { LatLng } from './DoggoMap';
import { Draft, legId, legDistance, meters } from './routeDraft';

export function splitLeg(d: Draft, index: number, at: LatLng): Draft {
  const leg = d.legs[index];
  if (!leg || !leg.snapped) throw new Error('Ajustez d’abord ce segment aux chemins.');
  const pts = leg.coordinates;
  let best = { distance: Infinity, edge: 0, point: pts[0] };
  // Project onto the closest polyline edge, not the closest sampled vertex.
  const scale = Math.max(.00001, Math.cos(at.latitude * Math.PI / 180));
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dx = (b.longitude - a.longitude) * scale, dy = b.latitude - a.latitude;
    const t = Math.max(0, Math.min(1, (((at.longitude - a.longitude) * scale * dx) + (at.latitude - a.latitude) * dy) / (dx * dx + dy * dy || 1)));
    const point = { latitude: a.latitude + t * (b.latitude - a.latitude), longitude: a.longitude + t * (b.longitude - a.longitude) };
    const distance = meters(at, point);
    if (distance < best.distance) best = { distance, edge: i, point };
  }
  if (best.distance > 35) throw new Error('Touchez directement le segment à l’endroit où vous voulez le couper.');
  const left = [...pts.slice(0, best.edge), best.point].filter((p, i, a) => !i || meters(a[i - 1], p) > .001);
  const right = [best.point, ...pts.slice(best.edge)].filter((p, i, a) => !i || meters(a[i - 1], p) > .001);
  if (legDistance({ ...leg, coordinates: left }) < 3 || legDistance({ ...leg, coordinates: right }) < 3) {
    throw new Error('Choisissez un point à au moins 3 m des extrémités du segment.');
  }
  const parts = [left, right].map(coordinates => ({ ...leg, id: legId(), gpsSamples: undefined, coordinates }));
  return { ...d, legs: [...d.legs.slice(0, index), ...parts, ...d.legs.slice(index + 1)] };
}
import { api } from './api';
import type { LatLng } from './DoggoMap';
import { appendReturn, closed, Draft, gapToStart, lastPoint, Leg, meters, usable, withinClosingDistance } from './routeDraft';

export async function requestPath(points: LatLng[], alternatives = false): Promise<LatLng[]> {
  const data = await api('/routing/snap', { method: 'POST', body: JSON.stringify({
    points: points.map(p => [p.latitude, p.longitude]), profile: 'foot', alternatives,
  }) });
  const coords = data?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2 || coords.some(p => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite) || Math.abs(p[0]) > 90 || Math.abs(p[1]) > 180)) {
    throw new Error('Le chemin calculé est inutilisable. Vos points sont conservés.');
  }
  const out = coords.map(p => ({ latitude: p[0], longitude: p[1] }));
  if (meters(out[0], points[0]) > 20 || meters(out.at(-1)!, points.at(-1)!) > 20) throw new Error('Le chemin ne rejoint pas le départ. Votre tracé est conservé.');
  out[0] = points[0]; out[out.length - 1] = points.at(-1)!;
  return out;
}
export async function snapDraft(draft: Draft): Promise<Draft> {
  const legs = [];
  for (const leg of draft.legs) {
    if (leg.snapped || leg.source !== 'draw') { legs.push(leg); continue; }
    const coordinates = await requestPath(leg.coordinates);
    legs.push({ ...leg, coordinates, snapped: true });
  }
  return { ...draft, legs };
}
export async function completeLoop(draft: Draft): Promise<Draft> {
  if (!usable(draft)) throw new Error('Parcours trop court. Ajoutez des points ou continuez à marcher avant de terminer.');
  if (closed(draft)) return draft;
  const from = lastPoint(draft)!;
  // ONLY invoked by explicit close/stop/complete actions, never a GPS callback.
  const points = withinClosingDistance(gapToStart(draft)) ? [from, draft.start!] : await requestPath([from, draft.start!], true);
  return appendReturn(draft, points);
}

export async function requestGpsMatch(leg: Leg): Promise<LatLng[]> {
  const samples = leg.gpsSamples || [];
  const data = await api('/routing/match', { method: 'POST', body: JSON.stringify({
    points: samples.map(p => [p.latitude, p.longitude]), timestamps: samples.map(p => Math.floor(p.timestamp / 1000)),
    accuracies: samples.map(p => p.accuracy), start_anchor: [leg.coordinates[0].latitude, leg.coordinates[0].longitude],
  }) });
  if (!Array.isArray(data?.coordinates) || data.coordinates.length < 2 || data.coordinates.some((p: number[]) => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite) || Math.abs(p[0]) > 90 || Math.abs(p[1]) > 180)) {
    throw new Error('Recalage GPS invalide. Les positions brutes sont conservées.');
  }
  const out: LatLng[] = data.coordinates.map((p: number[]) => ({ latitude: p[0], longitude: p[1] }));
  if (meters(out[0], leg.coordinates[0]) > .01 || meters(out.at(-1)!, samples.at(-1)!) > 20) throw new Error('Le recalage ne rejoint pas correctement les segments.');
  return out;
}
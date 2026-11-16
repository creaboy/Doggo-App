import { api } from './api';
import type { LatLng } from './DoggoMap';
import { appendReturn, closed, Draft, gapToStart, lastPoint, Leg, meters, resolvedLeg, usable, withinClosingDistance } from './routeDraft';

export type PathChoice = 'direct' | 'paths' | 'cancel';
export type PathConfirmation = { leg: Leg; reason?: string; gps?: boolean };
export type ConfirmPath = (request: PathConfirmation) => Promise<PathChoice>;
export class PathCancelled extends Error {
  constructor() { super('Segment annulé. Le tracé précédent est conservé.'); }
}
export function acceptOffPath(leg: Leg): Leg {
  return { ...leg, coordinates: leg.source === 'gps' ? leg.coordinates : [leg.coordinates[0], leg.coordinates.at(-1)!], offPath: true, snapped: false, sealed: true };
}
// A free segment is an explicit user decision. Routing failures never silently
// turn a route into a straight line, nor make a confirmed free segment invalid.
export async function resolvePath(leg: Leg, confirm: ConfirmPath, preferDirect = false): Promise<Leg> {
  let route = !preferDirect;
  let reason: string | undefined;
  for (;;) {
    if (route) {
      try { return { ...leg, coordinates: await requestPath([leg.coordinates[0], leg.coordinates.at(-1)!]), snapped: true, offPath: false }; }
      catch (error: any) { reason = error.message; }
    }
    const choice = await confirm({ leg, reason });
    if (choice === 'direct') return acceptOffPath(leg);
    if (choice === 'cancel') throw new PathCancelled();
    route = true;
  }
}

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
export async function snapDraft(draft: Draft, resolve?: (leg: Leg) => Promise<Leg>): Promise<Draft> {
  const legs = [];
  for (const leg of draft.legs) {
    if (resolvedLeg(leg) || leg.source !== 'draw') { legs.push(leg); continue; }
    if (resolve) { legs.push(await resolve(leg)); continue; }
    const coordinates = await requestPath(leg.coordinates);
    legs.push({ ...leg, coordinates, snapped: true });
  }
  return { ...draft, legs };
}
export async function completeLoop(draft: Draft, resolve?: (leg: Leg) => Promise<Leg>): Promise<Draft> {
  if (!usable(draft)) throw new Error('Parcours trop court. Ajoutez des points ou continuez à marcher avant de terminer.');
  if (closed(draft)) return draft;
  const from = lastPoint(draft)!;
  if (resolve && !withinClosingDistance(gapToStart(draft))) {
    const next = appendReturn(draft, [from, draft.start!]);
    const tail = next.legs.at(-1)!;
    const leg = await resolve({ ...tail, freedom: draft.legs.at(-1)!.freedom, snapped: false });
    return { ...next, legs: [...draft.legs, leg] };
  }
  // ONLY invoked by explicit close/stop/complete actions, never a GPS callback.
  const points = withinClosingDistance(gapToStart(draft)) ? [from, draft.start!] : await requestPath([from, draft.start!], true);
  const result = appendReturn(draft, points);
  if (draft.legs.at(-1)?.offPath) result.legs[result.legs.length - 1] = { ...result.legs.at(-1)!, freedom: draft.legs.at(-1)!.freedom, offPath: true, snapped: false };
  return result;
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

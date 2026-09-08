import type { LatLng } from './DoggoMap';
import { Draft, GpsSample, Freedom, lastPoint, legId, meters } from './routeDraft';

export function addGpsSample(d: Draft, sample: GpsSample, freedom: Freedom): Draft {
  const rawGps = [...(d.rawGps || []), sample];
  if (!d.start) return { start: { latitude: sample.latitude, longitude: sample.longitude }, legs: [], rawGps };
  const last = lastPoint(d)!;
  const tail = d.legs.at(-1);
  const point = { latitude: sample.latitude, longitude: sample.longitude };
  if (tail?.source === 'gps' && !tail.snapped && !tail.sealed && tail.freedom === freedom && (tail.gpsSamples?.length || 0) < 100) {
    return { ...d, rawGps, legs: [...d.legs.slice(0, -1), { ...tail, coordinates: [...tail.coordinates, point], gpsSamples: [...(tail.gpsSamples || []), sample] }] };
  }
  const previous = d.rawGps?.at(-1) || { ...last, timestamp: sample.timestamp - 2000, accuracy: sample.accuracy };
  return { ...d, rawGps, legs: [...d.legs.map(l => l.source === 'gps' && !l.snapped ? { ...l, sealed: true } : l),
    { id: legId(), coordinates: [last, point], freedom, source: 'gps', snapped: false, gpsSamples: [previous, sample] }] };
}

export function sealGps(d: Draft): Draft {
  return { ...d, legs: d.legs.map(l => l.source === 'gps' && !l.snapped ? { ...l, sealed: true } : l) };
}

export function acceptMatchedLeg(d: Draft, id: string, coordinates: LatLng[]): Draft {
  const index = d.legs.findIndex(l => l.id === id);
  if (index < 0) return d;
  const leg = d.legs[index];
  const end = coordinates.at(-1)!;
  const legs = d.legs.map((l, i) => {
    if (i === index) return { ...leg, coordinates, snapped: true, sealed: true };
    // The next raw window keeps its original samples, but display starts on the matched path.
    if (i === index + 1) return { ...l, coordinates: [end, ...l.coordinates.slice(1)] };
    return l;
  });
  return { ...d, legs };
}

export function restoreFinalGpsPosition(d: Draft): Draft {
  const raw = d.rawGps?.at(-1);
  const end = lastPoint(d);
  if (!raw || !end || meters(raw, end) < 0.001) return d;
  if (meters(raw, end) > 20) throw new Error('Le dernier point ajusté est trop loin du GPS. Vos positions restent conservées.');
  return { ...d, legs: [...d.legs, { id: legId(), source: 'return', generated: true, snapped: true,
    freedom: 'caution', coordinates: [end, { latitude: raw.latitude, longitude: raw.longitude }] }] };
}
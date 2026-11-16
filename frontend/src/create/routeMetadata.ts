import type { LatLng } from '../maps/types';
import type { Draft, Leg } from '../routeDraft';

export const featureOptions: Record<string, string> = { shade: 'Ombragé', water: 'Point d’eau', swimming: 'Baignade', parking: 'Parking', low_traffic: 'Peu de circulation', quiet: 'Calme', easy_path: 'Chemin facile' };
export const interestOptions: Record<string, string> = { water: 'Eau', swimming: 'Baignade', parking: 'Parking', viewpoint: 'Point de vue', trash: 'Poubelle', other: 'Autre intérêt' };
export const dangerOptions: Record<string, string> = { cars: 'Route dangereuse', crossing: 'Traversée de route', caterpillars: 'Chenilles', boars: 'Sangliers', livestock: 'Troupeaux', aggressive_dogs: 'Chiens agressifs', toxic: 'Plantes / aliments toxiques', hunting: 'Chasse', path_closed: 'Passage fermé / obstacle', dogs_prohibited: 'Chiens interdits', other: 'Autre danger' };
export type RouteNote = { id: string; kind: 'poi' | 'hazard'; type: string; coordinate: LatLng; description: string };
export type SegmentDetails = { features?: string[]; interests?: string[]; dangers?: string[]; notes?: string };
export type RouteVariant = { name: string; draft: Draft };

export function serializeSegments(legs: Leg[]) {
  return legs.map(({ freedom, coordinates, features = [], interests = [], dangers = [], notes = '' }) => ({
    freedom, coordinates: coordinates.map(p => [p.latitude, p.longitude]), features, interests, dangers, notes,
  }));
}
export function serializeNotes(notes: RouteNote[] = []) {
  const serialize = (kind: RouteNote['kind']) => notes.filter(n => n.kind === kind).map(n => ({ type: n.type, lat: n.coordinate.latitude, lng: n.coordinate.longitude, description: n.description }));
  return { pois: serialize('poi'), hazards: serialize('hazard') };
}
export function serializeVariant(variant: RouteVariant) {
  return { name: variant.name, segments: serializeSegments(variant.draft.legs), ...serializeNotes(variant.draft.annotations) };
}

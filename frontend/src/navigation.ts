import type { LatLng, SegmentInput } from './maps/types';
import { meters } from './routeDraft';

type Edge = { a: LatLng; b: LatLng; start: number; end: number };
type Route = { edges: Edge[]; total: number; turns: Turn[] };
type Turn = { at: number; side: 'left' | 'right' | 'uturn' };
export type NavigationProgress = { started: boolean; along: number; offRoute: boolean; arrived: boolean };
export const initialProgress: NavigationProgress = { started: false, along: 0, offRoute: false, arrived: false };

function bearing(a: LatLng, b: LatLng) {
  return Math.atan2((b.longitude - a.longitude) * Math.cos(a.latitude * Math.PI / 180), b.latitude - a.latitude) * 180 / Math.PI;
}

function pointAt(edges: Edge[], distance: number): LatLng {
  let low = 0, high = edges.length - 1;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (edges[mid].end < distance) low = mid + 1;
    else high = mid;
  }
  const edge = edges[low];
  const ratio = Math.max(0, Math.min(1, (distance - edge.start) / (edge.end - edge.start)));
  return {
    latitude: edge.a.latitude + ratio * (edge.b.latitude - edge.a.latitude),
    longitude: edge.a.longitude + ratio * (edge.b.longitude - edge.a.longitude),
  };
}

export function buildNavigation(segments: SegmentInput[]): Route {
  const edges: Edge[] = [];
  let total = 0;
  for (const { coordinates } of segments) {
    for (let i = 1; i < coordinates.length; i++) {
      const a = coordinates[i - 1], b = coordinates[i];
      const length = meters(a, b);
      if (length < 0.1) continue;
      edges.push({ a, b, start: total, end: total + length });
      total += length;
    }
  }
  const turns: Turn[] = [];
  // Group nearby corners and retain the strongest change in direction.
  let strongest = 0;
  for (let i = 1; i < edges.length; i++) {
    const edge = edges[i], at = edge.start;
    if (at < 12 || total - at < 12 || meters(edges[i - 1].b, edge.a) > 2) continue;
    const delta = (bearing(edge.a, pointAt(edges, at + 10)) - bearing(pointAt(edges, at - 10), edge.a) + 540) % 360 - 180;
    if (Math.abs(delta) < 48) continue;
    const turn: Turn = { at, side: Math.abs(delta) >= 150 ? 'uturn' : delta > 0 ? 'right' : 'left' };
    const previous = turns.at(-1);
    if (previous && at - previous.at < 20) {
      if (Math.abs(delta) > strongest) { turns[turns.length - 1] = turn; strongest = Math.abs(delta); }
    } else {
      turns.push(turn);
      strongest = Math.abs(delta);
    }
  }
  return { edges, total, turns };
}

export function projectOnRoute(route: Route, fix: LatLng, min = 0, max = route.total, preferred = min) {
  let best: { along: number; gap: number; score: number } | undefined;
  const scale = Math.cos(fix.latitude * Math.PI / 180);
  for (const edge of route.edges) {
    if (edge.end < min) continue;
    if (edge.start > max) break;
    const length = edge.end - edge.start;
    const x = (edge.b.longitude - edge.a.longitude) * scale, y = edge.b.latitude - edge.a.latitude;
    const dot = ((fix.longitude - edge.a.longitude) * scale * x + (fix.latitude - edge.a.latitude) * y) / (x * x + y * y || 1);
    const t = Math.max(0, (min - edge.start) / length, Math.min(1, (max - edge.start) / length, dot));
    const along = edge.start + t * length;
    const gap = meters(fix, { latitude: edge.a.latitude + t * y, longitude: edge.a.longitude + t * (edge.b.longitude - edge.a.longitude) });
    const score = gap + Math.abs(along - preferred) * 0.06;
    if (!best || score < best.score) best = { along, gap, score };
  }
  return best;
}

export function updateProgress(route: Route, previous: NavigationProgress, fix: LatLng, accuracy: number) {
  if (!route.edges.length || previous.arrived) return previous;
  if (!previous.started) {
    if (meters(fix, route.edges[0].a) > Math.min(25, Math.max(16, accuracy))) return previous;
    return { ...previous, started: true };
  }
  // Limit matching to the current part of the walk, even when the loop overlaps itself.
  const match = projectOnRoute(route, fix, Math.max(0, previous.along - 35), Math.min(route.total, previous.along + 90), previous.along);
  if (!match || match.gap > Math.max(previous.offRoute ? 23 : 35, accuracy)) return { ...previous, offRoute: true };
  const along = Math.max(previous.along, match.along);
  const arrived = along >= route.total - Math.min(12, route.total * .15)
    && meters(fix, route.edges.at(-1)!.b) <= 15;
  return { started: true, along: arrived ? route.total : along, offRoute: false, arrived };
}

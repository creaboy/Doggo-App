import type { LatLng } from '../DoggoMap';

// What the user is currently editing. A segment is the portion between two points,
// a point is one of the ordered points of the draft (index 0 = départ).
export type SegmentSelection = { kind: 'segment'; index: number; point: LatLng | null };
export type PointSelection = { kind: 'point'; index: number };
export type DraftSelection = SegmentSelection | PointSelection;

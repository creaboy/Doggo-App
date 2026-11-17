// Pictograms drawn in a 24 × 24 view box.
export const poiIcons = {
  water: 'M12 2C8 8 5 11 5 15a7 7 0 0 0 14 0c0-4-3-7-7-13Z',
  swimming: 'M2 16q2-3 5 0t5 0 5 0 5 0M2 21q2-3 5 0t5 0 5 0 5 0M5 13l5-5 5 4M15 6a2 2 0 1 0 4 0 2 2 0 1 0-4 0Z',
  parking: 'M8 21V3h6a5 5 0 0 1 0 10H8',
  viewpoint: 'M2 12s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6ZM9 12a3 3 0 1 0 6 0 3 3 0 1 0-6 0Z',
  trash: 'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7',
  other: 'M12 21s-7-6-7-12a7 7 0 1 1 14 0c0 6-7 12-7 12ZM10 9a2 2 0 1 0 4 0 2 2 0 1 0-4 0Z',
};

export const hazardIcons = {
  cars: 'M4 11l2-6h12l2 6M3 18V11h18v7H3Zm2 0v3m14-3v3M6 14h2m8 0h2',
  crossing: 'M9 3h6m-7 5h8M6 13h12M4 18h16',
  caterpillars: 'M3 17a3 3 0 0 1 6 0m0 0a3 3 0 0 1 6 0m0 0v-6a3 3 0 1 1 6 0v5c0 3-2 4-5 4H6c-2 0-3-1-3-3ZM16 8l-2-3m6 3 2-3',
  boars: 'M3 10 5 5l5 4h5l5-4 2 5-3 3-1 6H6l-1-6-2-3ZM8 16h8v5H8Zm3 2h.1m2 0h.1',
  livestock: 'M6 9C2 9 2 6 2 4l5 3h10l5-3c0 2 0 5-4 5M6 8v8l3 4h6l3-4V8M9 12h.1m6 0h.1M9 17h6',
  aggressive_dogs: 'M7 22c2-3 2-5 0-6l-3 2-2-2 3-1 1-3-2 1v-2l-2 1v-2L1 9V7l3-1 4 1 3-3 4 1 5-3-1 6 1 4 3 5-6 5H7Zm3-14 3 1-1-2Z',
  toxic: 'M4 10a8 8 0 1 1 16 0c0 3-2 5-4 6v5H8v-5c-2-1-4-3-4-6Zm4 0h1m6 0h1m-4 4v1m-1 4v2m2-2v2',
  hunting: 'M3 12h5m8 0h5M12 3v5m0 8v5M5 12a7 7 0 1 0 14 0 7 7 0 1 0-14 0Z',
  path_closed: 'M3 6h18v8H3ZM6 14v7m12-7v7M4 13l6-6m1 6 6-6',
  dogs_prohibited: 'M12 0a12 12 0 1 0 0 24 12 12 0 0 0 0-24ZM4.4 6l13.6 13.6A9.7 9.7 0 0 1 4.4 6ZM6 4.4A9.7 9.7 0 0 1 19.6 18L6 4.4ZM12.6 8.1l3-3.4.5 2.9 3 1.6-1.1 2.1h-2.1l-.7 1.2Zm-7.2.2 1.6 1.8 5.2 5.2.2 2.6H11v-3l-3.5-.9-1.3 3.9H4.8l.8-5.3Z',
  other: 'M12 3 2 21h20L12 3Zm0 6v5m0 3h.1',
};

export const pawPath = 'M12 11c-2 0-3 2-6 4-4 3-2 7 1 7 2 0 3-1 5-1s3 1 5 1c3 0 5-4 1-7-3-2-4-4-6-4ZM5 12a2.4 2.8 0 1 0 0-5.6 2.4 2.8 0 0 0 0 5.6Zm14 0a2.4 2.8 0 1 0 0-5.6 2.4 2.8 0 0 0 0 5.6ZM9 8a2.4 3 0 1 0 0-6 2.4 3 0 0 0 0 6Zm6 0a2.4 3 0 1 0 0-6 2.4 3 0 0 0 0 6Z';

export const filledHazardIcons = ['aggressive_dogs', 'dogs_prohibited'];

export type MarkerIcon = { kind: 'poi' | 'hazard'; type: string } | { kind: 'walk' };

export function annotationPath(kind: 'poi' | 'hazard', type: string) {
  const icons: Record<string, string> = kind === 'poi' ? poiIcons : hazardIcons;
  return Object.prototype.hasOwnProperty.call(icons, type) ? icons[type] : icons.other;
}

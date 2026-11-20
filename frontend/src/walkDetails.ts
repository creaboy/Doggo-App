const walkingSpeed: Record<string, number> = {
  city: 5, fields: 4.5, forest: 4, beach: 3.5, mountain: 3, mixed: 4,
};

export function estimateWalkMinutes(distanceKm: number, terrain: string, difficulty: string) {
  const pace = difficulty === 'sporty' ? 0.75 : difficulty === 'moderate' ? 0.9 : 1;
  return Math.max(1, Math.round(distanceKm * 60 / ((walkingSpeed[terrain] ?? walkingSpeed.mixed) * pace)));
}

export function mergeWalkNotes<T extends { type: string; lat: number; lng: number; description?: string }>(shared: T[], legacy: T[]) {
  const key = (note: T) => JSON.stringify([note.type, note.lat, note.lng, note.description || '']);
  const known = new Set(shared.map(key));
  // Older copies saved the shared markers again in the variant itself.
  return [...shared, ...legacy.filter(note => !known.has(key(note)))];
}

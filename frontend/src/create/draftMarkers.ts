import type { MarkerInput } from '../DoggoMap';
import { closed, Draft, draftPoints } from '../routeDraft';
import { colors } from '../theme';
import type { DraftSelection } from './selection';

// One tappable marker per ordered point of the draft. The number shown inside the pin
// is the point number, so removing or inserting a point visibly renumbers the rest.
export function draftMarkers(draft: Draft, selection: DraftSelection | null, onSelectPoint: (index: number) => void): MarkerInput[] {
  const loop = closed(draft);
  return draftPoints(draft).filter(point => !point.internal).map(point => ({
    id: point.start ? 'start' : `point-${point.index}`,
    coordinate: point.coordinate,
    color: point.start ? (loop ? colors.success : colors.brandPrimary) : colors.brandSecondary,
    badge: point.start ? 'D' : String(point.index + 1),
    label: point.start ? (loop ? 'Départ / arrivée · point 1' : 'Départ · point 1') : `Point ${point.index + 1}`,
    pointIndex: point.index,
    onPress: () => onSelectPoint(point.index),
  }));
}

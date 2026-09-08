import React from 'react';
import { View, Text, Pressable } from 'react-native';
import type { LatLng } from '../DoggoMap';
import { Draft, Freedom, legDistance } from '../routeDraft';
import { SegmentPicker } from './SegmentPicker';
import { styles } from './styles';

export type SegmentSelection = { index: number; point: LatLng | null } | null;
export function SegmentEditor({ draft, selection, prefix, disabled, recording, onFreedom, onSplit, onClose }: {
  draft: Draft; selection: SegmentSelection; prefix: string; disabled: boolean; recording: boolean;
  onFreedom: (index: number, value: Freedom) => void; onSplit: () => void; onClose: () => void;
}) {
  if (!selection || !draft.legs[selection.index]) return null;
  const leg = draft.legs[selection.index];
  const canSplit = !!selection.point && !!leg.snapped && !disabled && !recording;
  return <View style={styles.card} testID={`${prefix}-editor`}>
    <Text testID={`${prefix}-selected-label`} style={styles.text}>Segment {selection.index + 1} sélectionné · {(legDistance(leg) / 1000).toFixed(2)} km</Text>
    <SegmentPicker prefix={`${prefix}-rule`} value={leg.freedom} onChange={value => onFreedom(selection.index, value)} disabled={disabled} />
    <Text testID={`${prefix}-split-hint`} style={styles.hint}>{recording ? 'Terminez ou mettez en pause la balade avant de découper le tracé.' : selection.point ? 'Le point touché sur le tracé sera la séparation. Chaque portion gardera sa règle actuelle, modifiable ensuite.' : 'Pour découper : touchez le segment sur la carte à l’endroit de la séparation.'}</Text>
    <Pressable testID={`${prefix}-split`} disabled={!canSplit} onPress={onSplit} style={[styles.small, !canSplit && styles.disabled]}><Text style={styles.text}>Diviser à cet endroit</Text></Pressable>
    <Pressable testID={`${prefix}-close`} style={styles.small} onPress={onClose}><Text style={styles.hint}>Fermer la sélection</Text></Pressable>
  </View>;
}
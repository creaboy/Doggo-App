import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { legDistance } from '../routeDraft';
import type { Draft, Freedom } from '../routeDraft';
import { SegmentPicker } from './SegmentPicker';
import type { DraftSelection } from './selection';
import { styles } from './styles';

export function SegmentEditor({ draft, selection, prefix, disabled, recording, onFreedom, onInsert, onClose }: {
  draft: Draft; selection: DraftSelection | null; prefix: string; disabled: boolean; recording: boolean;
  onFreedom: (index: number, value: Freedom) => void; onInsert: () => void; onClose: () => void;
}) {
  if (selection?.kind !== 'segment' || !draft.legs[selection.index]) return null;
  const leg = draft.legs[selection.index];
  const canInsert = !!selection.point && !!leg.snapped && !disabled && !recording;
  return <View style={styles.card} testID={`${prefix}-editor`}>
    <Text testID={`${prefix}-selected-label`} style={styles.text}>Segment {selection.index + 1} sélectionné · {(legDistance(leg) / 1000).toFixed(2)} km</Text>
    <SegmentPicker prefix={`${prefix}-rule`} value={leg.freedom} onChange={value => onFreedom(selection.index, value)} disabled={disabled} />
    <Text testID={`${prefix}-insert-hint`} style={styles.hint}>{recording ? 'Terminez ou mettez en pause la balade avant d’ajouter un point.'
      : selection.point ? 'Le point touché sur la carte est ajouté entre les deux points de ce segment. Les points suivants sont renumérotés d’un rang.'
        : 'Pour ajouter un point : touchez le segment sur la carte à l’endroit souhaité.'}</Text>
    <Pressable testID={`${prefix}-insert-point`} disabled={!canInsert} onPress={onInsert} style={[styles.small, !canInsert && styles.disabled]}>
      <Text style={styles.text}>Ajouter un point ici</Text>
    </Pressable>
    <Pressable testID={`${prefix}-close`} style={styles.small} onPress={onClose}><Text style={styles.hint}>Fermer la sélection</Text></Pressable>
  </View>;
}

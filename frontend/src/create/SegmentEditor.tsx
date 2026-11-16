import React from 'react';
import { View, Text, Pressable, TextInput } from 'react-native';
import { legDistance } from '../routeDraft';
import type { Draft, Freedom } from '../routeDraft';
import { SegmentPicker } from './SegmentPicker';
import type { DraftSelection } from './selection';
import { styles } from './styles';
import { ChoiceChips } from './ChoiceChips';
import { featureOptions, interestOptions, dangerOptions } from './routeMetadata';
import type { SegmentDetails } from './routeMetadata';
import { colors } from '../theme';

export function SegmentEditor({ draft, selection, prefix, disabled, recording, onFreedom, onInsert, onClose, onDetails }: {
  draft: Draft; selection: DraftSelection | null; prefix: string; disabled: boolean; recording: boolean;
  onFreedom: (index: number, value: Freedom) => void; onInsert: () => void; onClose: () => void;
  onDetails?: (index: number, details: SegmentDetails) => void;
}) {
  if (selection?.kind !== 'segment' || !draft.legs[selection.index]) return null;
  const leg = draft.legs[selection.index];
  const canInsert = !!selection.point && !!leg.snapped && !disabled && !recording;
  return <View style={styles.card} testID={`${prefix}-editor`}>
    <Text testID={`${prefix}-selected-label`} style={styles.text}>Segment {selection.index + 1} sélectionné · {(legDistance(leg) / 1000).toFixed(2)} km</Text>
    <SegmentPicker prefix={`${prefix}-rule`} value={leg.freedom} onChange={value => onFreedom(selection.index, value)} disabled={disabled} />
    {onDetails && <>
      <ChoiceChips label="Caractéristiques" prefix={`${prefix}-feature`} options={featureOptions} values={leg.features || []} disabled={disabled} onChange={features => onDetails(selection.index, { features })} />
      <ChoiceChips label="Intérêts sur cette portion" prefix={`${prefix}-interest`} options={interestOptions} values={leg.interests || []} disabled={disabled} onChange={interests => onDetails(selection.index, { interests })} />
      <ChoiceChips label="Dangers sur cette portion" prefix={`${prefix}-danger`} options={dangerOptions} values={leg.dangers || []} disabled={disabled} onChange={dangers => onDetails(selection.index, { dangers })} />
      <TextInput testID={`${prefix}-notes`} accessibilityLabel="Conseils pour ce segment" placeholder="Conseils pour cette portion…" placeholderTextColor={colors.muted} style={styles.input} multiline editable={!disabled}
        value={leg.notes || ''} onChangeText={notes => onDetails(selection.index, { notes })} />
    </>}
    <Text testID={`${prefix}-insert-hint`} style={styles.hint}>{recording ? 'Terminez ou mettez en pause la balade avant d’ajouter un point.'
      : selection.point ? 'Le point touché sur la carte est ajouté entre les deux points de ce segment. Les points suivants sont renumérotés d’un rang.'
        : 'Pour ajouter un point : touchez le segment sur la carte à l’endroit souhaité.'}</Text>
    <Pressable testID={`${prefix}-insert-point`} disabled={!canInsert} onPress={onInsert} style={[styles.small, !canInsert && styles.disabled]}>
      <Text style={styles.text}>Ajouter un point ici</Text>
    </Pressable>
    <Pressable testID={`${prefix}-close`} style={styles.small} onPress={onClose}><Text style={styles.hint}>Fermer la sélection</Text></Pressable>
  </View>;
}

import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Trash } from 'phosphor-react-native';
import { colors } from '../theme';
import { Draft, draftPoints, meters } from '../routeDraft';
import type { PointSelection } from './selection';
import { styles } from './styles';

export function PointEditor({ draft, selection, prefix, disabled, onRemove, onClose }: {
  draft: Draft; selection: PointSelection | null; prefix: string; disabled: boolean;
  onRemove: () => void; onClose: () => void;
}) {
  if (!selection) return null;
  const points = draftPoints(draft);
  const point = points[selection.index];
  if (!point) return null;
  const previous = points[selection.index - 1];
  const next = points[selection.index + 1];
  const canRemove = !point.start && !!previous && !disabled;
  const rebuiltLength = previous && next ? Math.round(meters(previous.coordinate, next.coordinate)) : 0;
  return <View style={styles.card} testID={`${prefix}-editor`}>
    <Text testID={`${prefix}-selected-label`} style={styles.text}>
      {point.start ? 'Point 1 sélectionné · départ' : `Point ${point.index + 1} sélectionné`}
    </Text>
    <Text testID={`${prefix}-remove-hint`} style={styles.hint}>
      {point.start
        ? 'Le départ de la boucle reste fixe. Touchez un autre point pour le modifier.'
        : disabled
          ? 'Terminez ou mettez en pause la balade avant de modifier le tracé.'
          : 'La suppression réunit les deux segments voisins en un seul, recalculé sur les chemins piétons. Rien n’est perdu : « Annuler » restaure le point.'}
    </Text>
    {!point.start && !disabled && <Text testID={`${prefix}-remove-distance`} style={styles.hint}>
      {next
        ? `Segment reconstruit entre le point ${previous.index + 1} et le point ${next.index + 1} : environ ${rebuiltLength} m à vol d’oiseau avant ajustement.`
        : 'Ce point termine le tracé : le dernier segment en trop est retiré.'}
    </Text>}
    <Pressable testID={`${prefix}-remove-point`} disabled={!canRemove} onPress={onRemove}
      style={({ pressed }) => [styles.small, (!canRemove || pressed) && styles.disabled]}>
      <Trash size={16} color={canRemove ? colors.error : colors.muted} />
      <Text style={styles.text}>Supprimer ce point</Text>
    </Pressable>
    <Pressable testID={`${prefix}-close`} style={styles.small} onPress={onClose}><Text style={styles.hint}>Fermer la sélection</Text></Pressable>
  </View>;
}

import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { colors } from '../theme';
import type { Freedom } from '../routeDraft';
import { styles } from './styles';

const options: { key: Freedom; label: string; color: string }[] = [
  { key: 'free', label: 'Sans laisse', color: colors.success },
  { key: 'caution', label: 'Attention', color: colors.warning },
  { key: 'leash', label: 'En laisse', color: colors.error },
];
export function SegmentPicker({ value, onChange, prefix = 'freedom', disabled = false }: { value: Freedom; onChange: (f: Freedom) => void; prefix?: string; disabled?: boolean }) {
  return <View style={styles.row}>{options.map(o => <Pressable key={o.key} testID={`${prefix}-${o.key}`} disabled={disabled}
    accessibilityRole="radio" accessibilityState={{ checked: value === o.key, disabled }}
    onPress={() => onChange(o.key)} style={({ pressed }) => [styles.chip, value === o.key && styles.active, (disabled || pressed) && styles.disabled]}>
    <View style={[styles.dot, { backgroundColor: o.color }]} /><Text style={[styles.text, value === o.key && styles.onBrand]}>{o.label}</Text>
  </Pressable>)}</View>;
}
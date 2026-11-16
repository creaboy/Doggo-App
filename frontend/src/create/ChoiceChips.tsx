import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { styles } from './styles';

export function ChoiceChips({ label, options, values, onChange, disabled = false, prefix }: {
  label: string; options: Record<string, string>; values: string[]; onChange: (values: string[]) => void; disabled?: boolean; prefix: string;
}) {
  return <View style={{ gap: 8 }}><Text style={styles.label}>{label}</Text><View style={styles.row}>
    {Object.entries(options).map(([key, title]) => <Pressable key={key} testID={`${prefix}-${key}`} accessibilityRole="checkbox"
      accessibilityState={{ checked: values.includes(key), disabled }} disabled={disabled}
      style={[styles.chip, values.includes(key) && styles.active]} onPress={() => onChange(values.includes(key) ? values.filter(v => v !== key) : [...values, key])}>
      <Text style={[styles.text, values.includes(key) && styles.onBrand]}>{title}</Text>
    </Pressable>)}
  </View></View>;
}

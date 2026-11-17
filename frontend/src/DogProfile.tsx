import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { PawPrint } from 'phosphor-react-native';
import { colors, radius, spacing } from './theme';

export const temperaments = [
  { value: 'friendly', label: 'Amical' },
  { value: 'ok', label: 'OK' },
  { value: 'not_ok', label: 'Pas OK' },
] as const;
export type Temperament = typeof temperaments[number]['value'];
export const audiences = [
  { key: 'dogs', label: 'Chiens' },
  { key: 'adults', label: 'Humains adultes' },
  { key: 'children', label: 'Enfants' },
] as const;
export type DogProfile = Record<typeof audiences[number]['key'], Temperament> & {
  name: string;
  age_months: number;
  photo_jpeg: string | null;
  visible: boolean;
};

export function DogPhoto({ photo, name }: { photo: string | null; name: string }) {
  return photo
    ? <Image source={{ uri: `data:image/jpeg;base64,${photo}` }} accessibilityLabel={`Photo de ${name}`} style={styles.photo} />
    : <View style={[styles.photo, styles.placeholder]}><PawPrint size={36} color={colors.brandPrimary} /></View>;
}

export function DogCard({ dog, owner }: { dog: Omit<DogProfile, 'visible'>; owner?: string }) {
  const years = Math.floor(dog.age_months / 12);
  const months = dog.age_months % 12;
  const age = years ? `${years} an${years > 1 ? 's' : ''}${months ? ` et ${months} mois` : ''}` : `${months} mois`;
  return <View style={styles.card} testID="dog-profile-card">
    <View style={styles.identity}>
      <DogPhoto photo={dog.photo_jpeg} name={dog.name} />
      <View style={{ flex: 1 }}>
        <Text style={styles.name}>{dog.name}</Text>
        <Text style={styles.detail}>{age}</Text>
        {!!owner && <Text style={styles.detail}>Avec {owner}</Text>}
      </View>
    </View>
    {audiences.map(({ key, label }) => <View key={key} style={styles.relationship}>
      <Text style={styles.detail}>{label}</Text>
      <Text style={styles.status}>{temperaments.find(option => option.value === dog[key])?.label}</Text>
    </View>)}
  </View>;
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surfaceSecondary, padding: spacing.lg },
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm },
  photo: { width: 96, height: 96, borderRadius: radius.lg, backgroundColor: colors.surfaceTertiary },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 24, fontWeight: '800', color: colors.onSurface },
  detail: { fontSize: 15, color: colors.onSurface },
  relationship: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  status: { color: colors.brandPrimary, backgroundColor: colors.surfaceTertiary, borderRadius: radius.sm, paddingVertical: 4, paddingHorizontal: spacing.sm, fontWeight: '700' },
});

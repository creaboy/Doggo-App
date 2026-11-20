import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { DogCard } from '../../src/DogProfile';
import type { DogProfile } from '../../src/DogProfile';
import { colors, spacing } from '../../src/theme';

type SharedDog = { owner_name: string; owner_bio?: string; dog: Omit<DogProfile, 'visible'> };

export default function SharedDogScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [result, setResult] = useState<SharedDog | null>();

  useEffect(() => {
    let active = true;
    api(`/members/${encodeURIComponent(id)}/dog`).then((data: SharedDog) => {
      if (active) setResult(data);
    }).catch(() => {
      if (active) setResult(null);
    });
    return () => { active = false; };
  }, [id]);

  return <ScrollView style={{ flex: 1, backgroundColor: colors.surface }}
    contentContainerStyle={{ paddingTop: insets.top + spacing.md, paddingHorizontal: spacing.lg, gap: spacing.md }}>
    <Pressable accessibilityRole="button" onPress={() => router.back()} style={{ alignSelf: 'flex-start', paddingVertical: spacing.sm }}>
      <Text style={{ color: colors.brandPrimary, fontWeight: '700' }}>‹ Retour</Text>
    </Pressable>
    {result === undefined ? <ActivityIndicator color={colors.brandPrimary} />
      : result ? <>
        <DogCard dog={result.dog} owner={result.owner_name} />
        {!!result.owner_bio && <Text style={{ color: colors.onSurface }}>{result.owner_bio}</Text>}
      </>
      : <Text style={{ color: colors.onSurface }}>Cette fiche chien n’est pas disponible.</Text>}
  </ScrollView>;
}

import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { WalkCreationScreen, type WalkEditDraft } from '../../src/create/WalkCreationScreen';
import type { RouteNote, RouteVariant, SegmentDetails } from '../../src/create/routeMetadata';
import { legId, type Freedom } from '../../src/routeDraft';
import { colors, spacing } from '../../src/theme';

type SavedRoute = { duration_min?: number; segments: (SegmentDetails & {
  coordinates: [number, number][]; freedom: Freedom; off_path?: boolean;
})[] };
type SavedNote = { type: string; lat: number; lng: number; description?: string };
type WalkDetails = {
  can_edit: boolean; pois: SavedNote[]; hazards: SavedNote[];
  walk: SavedRoute & { id: string; edit_revision?: string; title: string; description: string;
    environment: string; difficulty: string; dog_freedom: string; variants?: (SavedRoute & { name: string })[] };
};

function toVariant(name: string, route: SavedRoute): RouteVariant {
  const legs = route.segments.map(({ coordinates, off_path, ...details }) => ({
    ...details, id: legId(), source: 'draw' as const, snapped: !off_path, offPath: !!off_path,
    coordinates: coordinates.map(([latitude, longitude]) => ({ latitude, longitude })),
  }));
  return { name, durationMin: route.duration_min, draft: { start: legs[0]?.coordinates[0] ?? null, legs } };
}

export default function EditWalk() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [edit, setEdit] = useState<WalkEditDraft>();
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void api(`/walks/${encodeURIComponent(id)}`).then(({ walk, can_edit, pois, hazards }: WalkDetails) => {
      if (cancelled) return;
      if (!can_edit) { setError('Seul l’auteur peut modifier cette balade.'); return; }
      const notes = (kind: RouteNote['kind'], values: SavedNote[]) => values.map((note, i) => ({
        id: `${kind}-${i}`, kind, type: note.type, description: note.description || '',
        coordinate: { latitude: note.lat, longitude: note.lng },
      }));
      setEdit({ id: walk.id, revision: walk.edit_revision ?? 'initial', title: walk.title,
        description: walk.description ?? '', environment: walk.environment, difficulty: walk.difficulty,
        dogFreedom: walk.dog_freedom, routes: [toVariant('A', walk), ...(walk.variants || []).map(v => toVariant(v.name, v))],
        annotations: [...notes('poi', pois), ...notes('hazard', hazards)],
      });
    }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [id]);

  if (edit) return <WalkCreationScreen edit={edit} />;
  return <View style={{ flex: 1, padding: spacing.lg, paddingTop: insets.top + spacing.lg, gap: spacing.lg }}>
    <Pressable accessibilityRole="button" onPress={() => router.back()}><Text style={{ color: colors.brandPrimary }}>‹ Retour</Text></Pressable>
    {error ? <Text accessibilityRole="alert" style={{ color: colors.error }}>{error}</Text> : <ActivityIndicator color={colors.brandPrimary} />}
  </View>;
}

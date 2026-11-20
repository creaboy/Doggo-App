import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { api } from '../src/api';
import { audiences, DogCard, DogPhoto, temperaments } from '../src/DogProfile';
import type { DogProfile, Temperament } from '../src/DogProfile';
import { colors, radius, spacing } from '../src/theme';

export default function EditDogProfile() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [years, setYears] = useState('');
  const [months, setMonths] = useState('');
  const [relationships, setRelationships] = useState<Partial<Record<typeof audiences[number]['key'], Temperament>>>({});
  const [photo, setPhoto] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<DogProfile | null>(null);

  useEffect(() => {
    let active = true;
    api('/me/dog').then((dog: DogProfile | null) => {
      if (!active || !dog) return;
      setName(dog.name);
      setBio(dog.bio || '');
      setYears(String(Math.floor(dog.age_months / 12)));
      setMonths(String(dog.age_months % 12));
      setRelationships({ dogs: dog.dogs, adults: dog.adults, children: dog.children });
      setPhoto(dog.photo_jpeg);
      setVisible(dog.visible);
    }).catch(() => {
      if (active) { setLoadFailed(true); setError('Impossible de charger la fiche.'); }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt]);

  const choosePhoto = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const selected = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] });
      if (selected.canceled) return;
      const image = selected.assets[0];
      const context = ImageManipulator.manipulate(image.uri);
      if (Math.max(image.width, image.height) > 600) {
        context.resize(image.width >= image.height ? { width: 600 } : { height: 600 });
      }
      const resized = await context.renderAsync();
      const jpeg = await resized.saveAsync({ format: SaveFormat.JPEG, compress: 0.82, base64: true });
      if (!jpeg.base64) throw new Error('Image vide');
      setPhoto(jpeg.base64);
    } catch { setError('Impossible d’ouvrir cette photo. Essaie une autre image.'); }
    finally { setBusy(false); }
  };

  const save = async () => {
    if (busy) return;
    setError('');
    const age = Number(years) * 12 + Number(months);
    if (!name.trim()) { setError('Indique le nom de ton chien.'); return; }
    if ((!years && !months) || !/^\d*$/.test(years) || !/^\d*$/.test(months) || Number(months) > 11 || age > 360) {
      setError('Indique un âge valide, avec au maximum 11 mois en plus des années.'); return;
    }
    const { dogs, adults, children } = relationships;
    if (!dogs || !adults || !children) { setError('Choisis une réponse pour les chiens, les adultes et les enfants.'); return; }
    setBusy(true);
    try {
      const dog: DogProfile = await api('/me/dog', {
        method: 'PUT',
        body: JSON.stringify({ name: name.trim(), bio: bio.trim(), age_months: age, dogs, adults, children, photo_jpeg: photo, visible }),
      });
      setSaved(dog);
      setPhoto(dog.photo_jpeg);
    } catch { setError('Impossible d’enregistrer la fiche. Tu peux réessayer.'); }
    finally { setBusy(false); }
  };

  return <ScrollView style={styles.screen} keyboardShouldPersistTaps="handled"
    contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.lg }]}>
    <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.back}><Text style={styles.link}>‹ Profil</Text></Pressable>
    <Text style={styles.title}>Mon chien</Text>
    {loading ? <ActivityIndicator color={colors.brandPrimary} /> : loadFailed ? <>
      <Text style={styles.error}>{error}</Text>
      <Pressable style={styles.action} onPress={() => { setLoading(true); setLoadFailed(false); setError(''); setAttempt(value => value + 1); }}><Text style={styles.link}>Réessayer</Text></Pressable>
    </> : saved ? <>
      <DogCard dog={saved} />
      <Text style={styles.help}>{saved.visible ? 'Fiche partagée avec les membres depuis tes balades publiées.' : 'Fiche privée.'}</Text>
      <Pressable accessibilityRole="button" style={styles.action} onPress={() => setSaved(null)}><Text style={styles.link}>Modifier la fiche</Text></Pressable>
    </> : <>
      <View style={styles.row}>
        <DogPhoto photo={photo} name={name || 'ton chien'} />
        <View style={styles.photoActions}>
          <Pressable accessibilityRole="button" testID="dog-choose-photo" disabled={busy} style={styles.action} onPress={choosePhoto}>
            <Text style={styles.link}>{photo ? 'Changer la photo' : 'Ajouter une photo'}</Text>
          </Pressable>
          {!!photo && <Pressable accessibilityRole="button" disabled={busy} onPress={() => setPhoto(null)}><Text style={styles.link}>Retirer la photo</Text></Pressable>}
        </View>
      </View>
      <Text style={styles.label}>Nom</Text>
      <TextInput testID="dog-name" accessibilityLabel="Nom du chien" value={name} onChangeText={setName} maxLength={40} style={styles.input} editable={!busy} />
      <Text style={styles.label}>Âge</Text>
      <View style={styles.row}>
        <TextInput testID="dog-age-years" accessibilityLabel="Âge en années" placeholder="Années" value={years} onChangeText={setYears}
          keyboardType="number-pad" maxLength={2} style={[styles.input, styles.flex]} editable={!busy} />
        <TextInput testID="dog-age-months" accessibilityLabel="Mois supplémentaires" placeholder="Mois" value={months} onChangeText={setMonths}
          keyboardType="number-pad" maxLength={2} style={[styles.input, styles.flex]} editable={!busy} />
      </View>
      {audiences.map(({ key, label }) => <View key={key} style={styles.group}>
        <Text style={styles.label}>{label}</Text>
        <View style={styles.row} accessibilityRole="radiogroup">
          {temperaments.map(option => {
            const selected = relationships[key] === option.value;
            return <Pressable key={option.value} testID={`dog-${key}-${option.value}`} accessibilityRole="radio"
              accessibilityLabel={`${label}, ${option.label}`} accessibilityState={{ checked: selected }}
              disabled={busy} style={[styles.action, selected && styles.primary]}
              onPress={() => setRelationships(previous => ({ ...previous, [key]: option.value }))}>
              <Text style={selected ? styles.onBrand : styles.link}>{option.label}</Text>
            </Pressable>;
          })}
        </View>
      </View>)}
      <Text style={styles.label}>Description</Text>
      <TextInput accessibilityLabel="Description du chien" value={bio} onChangeText={setBio} maxLength={240} multiline
        placeholder="Présente ton chien en quelques mots" placeholderTextColor={colors.muted}
        style={[styles.input, { minHeight: 68, textAlignVertical: 'top', paddingVertical: spacing.sm }]} editable={!busy} />
      <View style={styles.sharing}>
        <View style={styles.flex}><Text style={styles.label}>Partager la fiche</Text>
          <Text style={styles.help}>Les membres pourront la voir depuis tes balades publiées.</Text>
        </View>
        <Switch testID="dog-visibility" accessibilityLabel="Partager la fiche" value={visible} onValueChange={setVisible} disabled={busy} />
      </View>
      {!!error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
      <Pressable testID="save-dog-profile" accessibilityRole="button" disabled={busy} style={[styles.action, styles.primary]} onPress={save}>
        {busy ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.onBrand}>Enregistrer la fiche</Text>}
      </Pressable>
    </>}
  </ScrollView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { gap: spacing.sm, paddingHorizontal: spacing.lg },
  back: { alignSelf: 'flex-start', paddingVertical: spacing.sm },
  title: { fontSize: 26, fontWeight: '800', color: colors.onSurface, marginBottom: spacing.sm },
  link: { color: colors.brandPrimary, fontWeight: '700' },
  label: { color: colors.onSurface, fontWeight: '700', fontSize: 15 },
  help: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  error: { color: colors.error, fontSize: 14 },
  input: { minHeight: 44, borderColor: colors.borderStrong, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, color: colors.onSurface },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  flex: { flex: 1 },
  group: { gap: spacing.xs, marginTop: spacing.xs },
  photoActions: { alignItems: 'flex-start', gap: spacing.sm },
  sharing: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginVertical: spacing.sm },
  action: { minHeight: 42, justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },
  primary: { backgroundColor: colors.brandPrimary },
  onBrand: { color: colors.onBrand, fontWeight: '700' },
});

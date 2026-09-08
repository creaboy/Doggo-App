import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, TextInput, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { colors, spacing } from '../../src/theme';
import { DoggoMap } from '../../src/DoggoMap';
import { useAuth } from '../../src/AuthContext';
import { environmentLabels, difficultyLabels, freedomLabels } from '../../src/labels';
import { useWalkCreation } from '../../src/useWalkCreation';
import { closed, rawGapToStart, regionFor, routeMarkers, stats } from '../../src/routeDraft';
import { SegmentPicker } from '../../src/create/SegmentPicker';
import { FinishDialog } from '../../src/create/FinishDialog';
import { RoutePreview } from '../../src/create/RoutePreview';
import { styles } from '../../src/create/styles';
import { SegmentEditor } from '../../src/create/SegmentEditor';

export default function CreateScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const c = useWalkCreation();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [environment, setEnvironment] = useState('forest');
  const [difficulty, setDifficulty] = useState('easy');
  const [dogFreedom, setDogFreedom] = useState('free');
  const [duration, setDuration] = useState('30');
  const [initialRegion, setInitialRegion] = useState({ latitude: 48.85, longitude: 2.35, latitudeDelta: .025, longitudeDelta: .025 });
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== 'granted') return;
        const loc = await Location.getCurrentPositionAsync({});
        if (!cancelled) setInitialRegion({ latitude: loc.coords.latitude, longitude: loc.coords.longitude, latitudeDelta: .015, longitudeDelta: .015 });
      } catch { /* GPS recording reports permission errors explicitly when requested. */ }
    })();
    return () => { cancelled = true; };
  }, []);
  const totals = stats(c.draft);
  const isClosed = closed(c.draft);
  const publish = async () => {
    c.setError('');
    if (!user) { c.setError('Connectez-vous pour publier.'); return; }
    if (!title.trim()) { c.setError('Ajoutez un titre dans les détails du tracé avant de publier.'); return; }
    if (!/^\d+$/.test(duration) || Number(duration) < 1) { c.setError('Saisissez une durée positive en minutes.'); return; }
    try {
      const walk = await c.publish({ title: title.trim(), description: description.trim(), environment, difficulty, dog_freedom: dogFreedom, duration_min: Number(duration) });
      c.setPreview(false); c.clear(); setTitle(''); setDescription(''); setDuration('30'); router.push(`/walk/${walk.id}`);
    } catch (e: any) { c.setError(e.message || 'Publication impossible. Votre boucle est conservée.'); }
  };
  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.root}>
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
      <Text testID="create-title" style={styles.title}>Créer une balade</Text>
      <View style={styles.row}>{(['draw', 'record'] as const).map(mode => <Pressable key={mode} testID={`mode-${mode}`} disabled={c.locked}
        onPress={() => c.setMode(mode)} style={[styles.mode, c.mode === mode && styles.active, c.locked && styles.disabled]}>
        <Text style={[styles.text, c.mode === mode && styles.onBrand]}>{mode === 'draw' ? 'Dessiner' : 'Enregistrer GPS'}</Text>
      </Pressable>)}</View>
      {!!c.error && !c.preview && !c.finishOpen && <Text testID="create-route-alert" style={styles.error} accessibilityRole="alert">{c.error}</Text>}
    </View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}>
      <View style={styles.map}><DoggoMap testID="create-map" initialRegion={isClosed ? regionFor(c.draft) : initialRegion}
        segments={c.draft.legs.map(l => ({ ...l, pending: !l.snapped }))} markers={routeMarkers(c.draft)} onPress={c.mode === 'draw' && !c.locked ? c.tap : undefined}
        onSegmentPress={c.selectSegment} selectedSegmentIndex={c.selection?.index}
        showsUserLocation userCoordinate={c.recorder.position} fitToRoute={isClosed && !c.recorder.recording} /></View>
      <View style={styles.section}>
        <Text testID="route-status" style={isClosed ? styles.notice : styles.hint}>{c.recorder.recording ? 'Balade en cours · seul le bouton Terminer arrête le GPS' : isClosed ? 'Boucle fermée · départ = arrivée' : 'Le premier point est votre départ. Revenez-y pour former une boucle.'}</Text>
        <Text testID="route-live-stats" style={styles.text}>{totals.distanceKm.toFixed(2)} km · {totals.offLeashPct}% sans laisse · {c.draft.legs.reduce((n, l) => n + l.coordinates.length - 1, c.draft.start ? 1 : 0)} points</Text>
        {c.mode === 'draw' ? <>
          <Text testID="draw-instructions" style={styles.hint}>Chaque nouveau segment suit immédiatement les chemins. Touchez un segment pour changer sa règle ou le diviser.</Text>
          <View style={styles.row}>
            <Action id="undo-point" label="Annuler le dernier ajout" onPress={c.undo} disabled={c.locked || !c.draft.start} />
            <Action id="clear-points" label="Effacer" onPress={c.clear} disabled={c.locked || !c.draft.start} />
            <Action id="snap-path" label="Suivre les chemins" onPress={c.snap} disabled={c.locked || !c.draft.legs.length} />
          </View>
          <Pressable testID="close-loop" disabled={c.locked || !c.draft.legs.length || isClosed} style={[styles.primary, (c.locked || !c.draft.legs.length || isClosed) && styles.disabled]} onPress={c.closeManual}>
            <Text style={[styles.text, styles.onBrand]}>{isClosed ? 'Boucle déjà fermée' : 'Fermer la boucle'}</Text>
          </Pressable>
        </> : <>
          <Text testID="gps-recording-status" style={styles.hint}>{c.recorder.recording || c.recorder.starting ? c.recorder.signal : 'L’enregistrement s’arrête uniquement quand vous le décidez.'}</Text>
          <Text testID="gps-foreground-note" style={styles.hint}>Gardez Doggo ouvert pendant l’enregistrement GPS.</Text>
          <Text testID="gps-snap-status" style={styles.notice}>{c.gps.message}</Text>
          <Text testID="gps-raw-count" style={styles.hint}>{c.draft.rawGps?.length || 0} positions GPS brutes conservées · l’ajustement ne modifie pas le point de départ</Text>
          {c.gps.busy && <ActivityIndicator testID="gps-snap-busy" color={colors.brandPrimary} />}
          {!!c.gps.error && <Text testID="gps-snap-error" style={styles.error}>{c.gps.error}</Text>}
          <View style={styles.row}>
            {c.recorder.recording || c.recorder.starting ? <Action id="stop-record" label="Terminer la balade" onPress={c.stop} disabled={!!c.busy} />
              : <Action id="start-record" label={c.draft.start ? 'Reprendre l’enregistrement' : 'Démarrer la balade'} onPress={c.start} disabled={!!c.busy} />}
            <Action id="clear-points" label="Effacer" onPress={c.clear} disabled={c.locked || !c.draft.start} />
            {!c.recorder.recording && <Action id="retry-gps-snap" label="Réessayer l’ajustement" onPress={c.snap} disabled={c.locked || !c.draft.legs.length} />}
            {isClosed && <Action id="undo-point" label="Annuler la fermeture" onPress={c.undo} disabled={c.locked} />}
          </View>
        </>}
        <Text testID="segment-freedom-label" style={styles.label}>Liberté des prochains segments</Text>
        <SegmentPicker value={c.freedom} onChange={c.setFreedom} disabled={!!c.busy} />
        {!!c.draft.legs.length && <>
          <Text testID="select-segment-instructions" style={styles.hint}>Touchez une portion sur la carte, ou sélectionnez-la ci-dessous.</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
            {c.draft.legs.map((leg, i) => <Pressable key={leg.id || i} testID={`select-segment-${i}`} style={[styles.chip, c.selection?.index === i && styles.active]} onPress={() => c.selectSegment(i)}>
              <Text style={[styles.text, c.selection?.index === i && styles.onBrand]}>Segment {i + 1}{!leg.snapped ? ' · à ajuster' : ''}</Text>
            </Pressable>)}
          </ScrollView>
          <SegmentEditor prefix="create-segment" draft={c.draft} selection={c.selection} disabled={!!c.busy || c.gps.busy} recording={c.recorder.recording || c.recorder.starting}
            onFreedom={c.updateFreedom} onSplit={c.splitSelected} onClose={() => c.setSelection(null)} />
        </>}
        {!!c.error && <Text testID="create-error" accessibilityRole="alert" style={styles.error}>{c.error}</Text>}
        {!!c.notice && <Text testID="create-notice" accessibilityLiveRegion="polite" style={styles.notice}>{c.notice}</Text>}
        {!!c.busy && <View testID="route-busy" style={styles.row}><ActivityIndicator color={colors.brandPrimary} /><Text style={styles.hint}>{c.busy}</Text></View>}
      </View>
      <View style={styles.section}>
        <Text testID="details-label" style={styles.label}>Détails de la balade</Text>
        <TextInput testID="walk-title" style={styles.input} placeholder="Titre de la balade" placeholderTextColor={colors.muted} value={title} onChangeText={setTitle} />
        <TextInput testID="walk-desc" style={[styles.input, { minHeight: 80 }]} placeholder="Description (facultative)" placeholderTextColor={colors.muted} value={description} onChangeText={setDescription} multiline />
        <Text testID="duration-label" style={styles.hint}>Durée estimée, en minutes</Text>
        <TextInput testID="walk-duration" style={styles.input} placeholder="Durée en minutes" placeholderTextColor={colors.muted} value={duration} onChangeText={setDuration} keyboardType="number-pad" />
        <Choices prefix="env" label="Environnement" options={environmentLabels} value={environment} onChange={setEnvironment} />
        <Choices prefix="diff" label="Difficulté" options={difficultyLabels} value={difficulty} onChange={setDifficulty} />
        <Choices prefix="dogfree" label="Liberté globale du chien" options={freedomLabels} value={dogFreedom} onChange={setDogFreedom} />
        {c.mode === 'draw' && <View testID="manual-snap-info" style={styles.card}>
          <Text testID="auto-snap-state" style={styles.text}>Ajustement automatique à chaque segment</Text>
          <Text style={styles.hint}>Si un calcul échoue, le point reste conservé. Utilisez « Suivre les chemins » pour réessayer, ou annulez le dernier ajout. Un segment non ajusté ne sera pas publié.</Text>
        </View>}
        <Text testID="routing-privacy-note" style={styles.hint}>Le calcul transmet les points du trajet au service public FOSSGIS / OpenStreetMap. Vérifiez l’accès et les règles locales sur place.</Text>
        <Pressable testID="preview-route" disabled={c.locked} style={[styles.primary, c.locked && styles.disabled]} onPress={c.showPreview}><Text style={[styles.text, styles.onBrand]}>Vérifier la boucle avant publication</Text></Pressable>
      </View>
    </ScrollView>
    {c.finishOpen && <FinishDialog open gap={rawGapToStart(c.draft)} busy={c.busy} error={c.error} onComplete={c.finishReturn} onContinue={c.continueRecording} />}
    {c.preview && <RoutePreview open draft={c.draft} duration={duration} title={title} error={c.error} busy={c.busy}
      onBack={() => c.setPreview(false)} onPublish={publish} onFreedom={c.updateFreedom} selection={c.selection}
      onSelect={c.selectSegment} onSplit={c.splitSelected} onCloseSelection={() => c.setSelection(null)} onUndo={c.undo} canUndo={c.canUndoInPreview} />}
  </KeyboardAvoidingView>;
}

function Action({ id, label, onPress, disabled }: { id: string; label: string; onPress: () => void; disabled: boolean }) {
  return <Pressable testID={id} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.small, (disabled || pressed) && styles.disabled]}><Text style={styles.text}>{label}</Text></Pressable>;
}
function Choices({ prefix, label, options, value, onChange }: { prefix: string; label: string; options: Record<string, string>; value: string; onChange: (value: string) => void }) {
  return <><Text testID={`${prefix}-label`} style={styles.label}>{label}</Text><View style={styles.row}>
    {Object.entries(options).map(([k, v]) => <Pressable key={k} testID={`${prefix}-${k}`} onPress={() => onChange(k)} style={[styles.chip, value === k && styles.active]}><Text style={[styles.text, value === k && styles.onBrand]}>{v}</Text></Pressable>)}
  </View></>;
}
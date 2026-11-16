import React, { useRef, useState } from 'react';
import { View, Text, Pressable, TextInput, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { colors, spacing } from '../../src/theme';
import { DoggoMap, LatLng } from '../../src/DoggoMap';
import { useAuth } from '../../src/AuthContext';
import { useWalkCreation } from '../../src/useWalkCreation';
import { closed, draftPoints, emptyDraft, rawGapToStart, stats, usable } from '../../src/routeDraft';
import { draftMarkers } from '../../src/create/draftMarkers';
import { SegmentPicker } from '../../src/create/SegmentPicker';
import { FinishDialog } from '../../src/create/FinishDialog';
import { styles } from '../../src/create/styles';
import { SegmentEditor } from '../../src/create/SegmentEditor';
import { PointEditor } from '../../src/create/PointEditor';
import { AnnotationEditor } from '../../src/create/AnnotationEditor';
import { dangerOptions, interestOptions } from '../../src/create/routeMetadata';
import type { RouteNote, RouteVariant } from '../../src/create/routeMetadata';

const MAP_DEFAULT_REGION = { latitude: 48.85, longitude: 2.35, latitudeDelta: .025, longitudeDelta: .025 };
const steps = ['Tracer', 'Affiner', 'Finaliser'];

export default function CreateScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const c = useWalkCreation();
  const scroll = useRef<React.ElementRef<typeof ScrollView>>(null);
  const [step, setStep] = useState(0);
  const [bank, setBank] = useState<RouteVariant[]>([{ name: 'A', draft: emptyDraft() }]);
  const [active, setActive] = useState(0);
  const [note, setNote] = useState<RouteNote | null>(null);
  const [movingPoint, setMovingPoint] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [environment, setEnvironment] = useState('forest');
  const [difficulty, setDifficulty] = useState('easy');
  const [dogFreedom, setDogFreedom] = useState('free');
  const [duration, setDuration] = useState('30');
  const variants = bank.map((v, i) => i === active ? { ...v, draft: c.draft } : v);
  const totals = stats(c.draft);
  const isClosed = closed(c.draft);
  const recording = c.recorder.recording || c.recorder.starting;
  const editable = step === 1 && !c.locked;
  const annotations = c.draft.annotations || [];
  const changeStep = (value: number) => {
    setMovingPoint(false); c.setSelection(null); c.setPreview(value === 2); c.setError(''); setStep(value); scroll.current?.scrollTo({ y: 0, animated: true });
  };
  const advance = async () => {
    if (c.locked) return;
    if (await c.showPreview()) changeStep(step + 1);
  };
  const switchVariant = (index: number, targetStep = 1) => {
    if (c.locked) return;
    setBank(variants); setActive(index); c.replaceDraft(variants[index].draft); changeStep(targetStep);
  };
  const addVariant = (copy: boolean) => {
    if (c.locked || variants.length >= 26) return;
    const name = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').find(letter => !variants.some(v => v.name === letter))!;
    const draft = copy ? structuredCopy(c.draft) : { ...emptyDraft(), start: variants[0].draft.start };
    setBank([...variants, { name, draft }]); setActive(variants.length); c.replaceDraft(draft); c.setMode('draw'); changeStep(copy ? 1 : 0);
  };
  const removeVariant = () => {
    if (c.locked || active === 0) return;
    const remaining = variants.filter((_, i) => i !== active);
    setBank(remaining); setActive(0); c.replaceDraft(remaining[0].draft); changeStep(2);
  };
  const openNote = (coordinate: LatLng) => setNote({ id: `note-${Date.now()}`, kind: 'poi', type: 'other', coordinate, description: '' });
  const clearActive = () => variants.length > 1 ? c.replaceDraft({ ...emptyDraft(), start: variants[0].draft.start }) : c.clear();
  const selectPoint = (index: number) => { setMovingPoint(false); c.selectPoint(index); };
  const selectSegment = (index: number, point?: LatLng) => { setMovingPoint(false); c.selectSegment(index, point); };
  const markers = [
    ...draftMarkers(c.draft, editable ? c.selection : null, editable ? selectPoint : () => {}),
    ...annotations.map(n => ({ id: n.id, coordinate: n.coordinate, color: n.kind === 'hazard' ? colors.error : colors.brandSecondary,
      badge: n.kind === 'hazard' ? '!' : '★', label: (n.kind === 'hazard' ? dangerOptions : interestOptions)[n.type], onPress: step < 2 ? () => setNote(n) : undefined })),
  ];
  const publish = async () => {
    c.setError('');
    if (!user) { c.setError('Connectez-vous pour publier.'); return; }
    if (!title.trim()) { c.setError('Donnez un titre à votre balade.'); return; }
    if (!/^\d+$/.test(duration) || Number(duration) < 1) { c.setError('Saisissez une durée positive en minutes.'); return; }
    try {
      const walk = await c.publish({ title: title.trim(), description: description.trim(), environment, difficulty, dog_freedom: dogFreedom, duration_min: Number(duration) }, variants);
      c.clear(); setBank([{ name: 'A', draft: emptyDraft() }]); setActive(0); setStep(0); setTitle(''); setDescription(''); setDuration('30');
      router.push(`/walk/${walk.id}`);
    } catch (e: any) { c.setError(e.message || 'Publication impossible. Vos itinéraires sont conservés.'); }
  };

  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.root}>
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
      <View style={[styles.row, { justifyContent: 'space-between' }]}><Text testID="create-title" style={styles.title}>Créer une balade</Text><Text style={styles.hint}>Itinéraire {bank[active].name}</Text></View>
      <View style={styles.row}>{steps.map((label, i) => <View key={label} style={[styles.step, step === i && styles.stepCurrent]}>
        <Text style={[styles.stepNumber, step === i && styles.onBrand]}>{i + 1}</Text><Text style={[styles.text, step === i && styles.onBrand]}>{label}</Text>
      </View>)}</View>
    </View>
    <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}>
      <View style={styles.intro}><Text testID="creation-step-title" style={styles.title}>{['Poser les grandes lignes', 'Le terrain, dans le détail', 'Partager votre balade'][step]}</Text>
        <Text style={styles.hint}>{[
          'Dessinez votre boucle ou laissez le GPS suivre vos pas. Un appui long sur la carte ajoute un intérêt ou un obstacle.',
          'Touchez une portion pour ajouter un point et renseigner ses caractéristiques. Touchez un point numéroté pour le supprimer.',
          'Ajoutez un titre et une description. Proposez aussi d’autres boucles pour varier la distance ou les envies.',
        ][step]}</Text></View>
      {step === 0 && <View style={styles.section}><View style={styles.row}>{(['draw', 'record'] as const).map(mode => <Pressable key={mode} testID={`mode-${mode}`} disabled={c.locked}
        onPress={() => c.setMode(mode)} style={[styles.mode, c.mode === mode && styles.active, c.locked && styles.disabled]}><Text style={[styles.text, c.mode === mode && styles.onBrand]}>{mode === 'draw' ? 'Dessiner sur la carte' : 'Marcher avec le GPS'}</Text></Pressable>)}</View></View>}
      <View style={styles.map}><DoggoMap testID="create-map" initialRegion={MAP_DEFAULT_REGION}
        segments={c.draft.legs.map(l => ({ ...l, pending: !l.snapped }))} markers={markers}
        onPress={movingPoint && editable ? point => { void c.movePoint(point); setMovingPoint(false); } : step === 0 && c.mode === 'draw' && !c.locked && !isClosed ? c.tap : undefined}
        onLongPress={step < 2 && !c.busy ? openNote : undefined}
        onSegmentPress={editable && !movingPoint ? selectSegment : undefined} selectedSegmentIndex={editable && c.selection?.kind === 'segment' ? c.selection.index : undefined}
        selectedPointIndex={editable && c.selection?.kind === 'point' ? c.selection.index : undefined}
        focusUserOnLoad={!c.draft.start} /></View>
      <View style={styles.section}>
        <View style={styles.stats}><View style={styles.stat}><Text testID="route-live-stats" style={styles.number}>{totals.distanceKm.toFixed(2)} km</Text><Text style={styles.hint}>Itinéraire {bank[active].name}</Text></View>
          <View style={styles.stat}><Text style={styles.number}>{c.draft.legs.length}</Text><Text style={styles.hint}>Segments</Text></View>
          <View style={styles.stat}><Text testID="route-status" style={[styles.text, isClosed && styles.notice]}>{recording ? 'GPS actif' : isClosed ? 'Boucle fermée' : 'À refermer'}</Text><Text style={styles.hint}>{draftPoints(c.draft).length} points</Text></View></View>
        {step === 0 && <>
          {c.mode === 'draw' ? <>
            <Text testID="draw-instructions" style={styles.hint}>{isClosed ? 'Votre boucle est prête. Passez à l’étape suivante pour la retoucher.' : 'Touchez la carte pour poser les grands points de passage. Les segments suivent les chemins piétons.'}</Text>
            <View style={styles.row}><Action id="undo-point" label="Annuler" onPress={c.undo} disabled={c.locked || !c.draft.start} /><Action id="clear-points" label="Recommencer" onPress={clearActive} disabled={c.locked || !c.draft.start} />
              <Action id="snap-path" label="Réajuster aux chemins" onPress={c.snap} disabled={c.locked || !c.draft.legs.length} /></View>
            {!isClosed && <Action id="close-loop" label="Rejoindre le départ et fermer la boucle" onPress={c.closeManual} disabled={c.locked || !usable(c.draft)} />}
          </> : <>
            <Text testID="gps-recording-status" style={styles.notice}>{recording ? c.recorder.signal : 'Le GPS trace pour vous. L’arrêt reste manuel.'}</Text>
            <Text style={styles.hint}>Gardez Doggo ouvert pendant l’enregistrement. Posez un nouveau segment quand le terrain ou les règles changent.</Text>
            <View style={styles.row}>{recording ? <>
              <Action id="stop-record" label="Terminer l’enregistrement" onPress={c.stop} disabled={!!c.busy} />
              <Action id="mark-segment" label="Nouveau segment ici" onPress={c.markSegment} disabled={!c.recorder.recording} />
            </> : <><Action id="start-record" label={c.draft.start ? 'Reprendre la marche' : 'Démarrer le GPS'} onPress={c.start} disabled={c.locked} />
              <Action id="clear-points" label="Recommencer" onPress={clearActive} disabled={c.locked || !c.draft.start} /></>}</View>
            <Text testID="gps-snap-status" style={styles.hint}>{c.gps.message}</Text>
            {!!c.gps.error && <><Text style={styles.error}>{c.gps.error}</Text><Action id="retry-gps-snap" label="Réessayer l’ajustement" onPress={c.snap} disabled={c.locked} /></>}
          </>}
          <Text style={styles.label}>Liberté du chien sur les prochains segments</Text><SegmentPicker value={c.freedom} onChange={c.setFreedom} disabled={!!c.busy} />
        </>}
        {step === 1 && <>
          {movingPoint && <View style={styles.card}><Text testID="move-point-hint" style={styles.notice}>Touchez le nouvel emplacement sur la carte.</Text><Action id="cancel-move-point" label="Annuler le déplacement" onPress={() => setMovingPoint(false)} disabled={false} /></View>}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>{c.draft.legs.map((leg, i) => <Pressable key={leg.id || i} testID={`select-segment-${i}`}
            style={[styles.chip, c.selection?.kind === 'segment' && c.selection.index === i && styles.active]} onPress={() => selectSegment(i)}>
            <Text style={[styles.text, c.selection?.kind === 'segment' && c.selection.index === i && styles.onBrand]}>Segment {i + 1}</Text></Pressable>)}</ScrollView>
          {!c.selection && <View style={styles.card}><Text style={styles.text}>Choisissez une portion sur la carte</Text><Text style={styles.hint}>Ajoutez des repères de découpe pour décrire précisément chaque portion : ombre, baignade, route à traverser, laisse…</Text></View>}
          <SegmentEditor prefix="create-segment" draft={c.draft} selection={c.selection} disabled={c.locked} recording={false}
            onFreedom={c.updateFreedom} onDetails={c.updateDetails} onInsert={c.splitSelected} onClose={() => c.setSelection(null)} />
          <PointEditor prefix="create-point" draft={c.draft} selection={c.selection?.kind === 'point' ? c.selection : null} disabled={c.locked} onRemove={c.removePoint} onMove={() => { setMovingPoint(true); scroll.current?.scrollTo({ y: 0, animated: true }); }} onClose={() => { setMovingPoint(false); c.setSelection(null); }} />
          <Action id="undo-point" label="Annuler la dernière retouche" onPress={c.undo} disabled={c.locked} />
          <Text style={styles.hint}>Vert : libre · orange : prudence · rouge : laisse.</Text>
        </>}
        {step < 2 && <>
          <Text style={styles.label}>Repères · {annotations.length}</Text><Text style={styles.hint}>Maintenez un doigt sur la carte pour signaler un point d’intérêt ou un danger. Touchez un repère pour le corriger.</Text>
          {annotations.map(n => <Pressable key={n.id} testID={`edit-${n.id}`} style={styles.card} onPress={() => setNote(n)}><Text style={styles.text}>{n.kind === 'hazard' ? '⚠' : '★'} {(n.kind === 'hazard' ? dangerOptions : interestOptions)[n.type]}</Text>{!!n.description && <Text style={styles.hint}>{n.description}</Text>}</Pressable>)}
        </>}
        {step === 2 && <>
          <Text style={styles.label}>Votre balade</Text>
          <TextInput testID="walk-title" accessibilityLabel="Titre de la balade" style={styles.input} placeholder="Un titre qui donne envie" placeholderTextColor={colors.muted} value={title} onChangeText={setTitle} />
          <TextInput testID="walk-desc" accessibilityLabel="Description de la balade" style={[styles.input, { minHeight: 100 }]} placeholder="Ambiance, accès, conseils pour venir avec son chien…" placeholderTextColor={colors.muted} value={description} onChangeText={setDescription} multiline />
          <Text style={styles.hint}>Durée de l’itinéraire A, en minutes</Text><TextInput testID="walk-duration" accessibilityLabel="Durée en minutes" style={styles.input} value={duration} onChangeText={setDuration} keyboardType="number-pad" />
          <Choices prefix="env" label="Environnement" options={{ forest: 'Forêt', fields: 'Campagne', city: 'Ville', beach: 'Plage', mountain: 'Montagne', mixed: 'Mixte' }} value={environment} onChange={setEnvironment} />
          <Choices prefix="diff" label="Difficulté" options={{ easy: 'Facile', moderate: 'Modérée', sporty: 'Sportive' }} value={difficulty} onChange={setDifficulty} />
          <Choices prefix="dogfree" label="Liberté globale" options={{ free: 'Sans laisse', partial: 'Selon les portions', leash: 'En laisse' }} value={dogFreedom} onChange={setDogFreedom} />
          <Text style={styles.label}>Une balade, plusieurs boucles</Text><Text style={styles.hint}>A est l’itinéraire principal. Vous pouvez dessiner une autre boucle depuis le même départ, ou retoucher une copie de l’itinéraire affiché.</Text>
          {variants.map((v, i) => <View key={v.name} style={styles.card} testID={`variant-${v.name}`}>
            <Text style={styles.text}>Itinéraire {v.name}{i === 0 ? ' · principal' : ''} · {stats(v.draft).distanceKm.toFixed(2)} km</Text>
            <Text style={closed(v.draft) && usable(v.draft) ? styles.notice : styles.error}>{closed(v.draft) && usable(v.draft) ? 'Boucle complète' : 'À terminer avant publication'}</Text>
            <View style={styles.row}><Action id={`edit-variant-${v.name}`} label="Retoucher" disabled={c.locked} onPress={() => switchVariant(i)} />
              <Action id={`trace-variant-${v.name}`} label="Revenir au tracé" disabled={c.locked} onPress={() => switchVariant(i, 0)} /></View>
          </View>)}
          <View style={styles.row}><Action id="add-variant" label="Dessiner une variante" onPress={() => addVariant(false)} disabled={c.locked || variants.length >= 26} />
            <Action id="copy-variant" label="Créer une variante à partir d’une copie" onPress={() => addVariant(true)} disabled={c.locked || variants.length >= 26} /></View>
          {active > 0 && <Action id="remove-variant" label={`Supprimer l’itinéraire ${bank[active].name}`} onPress={removeVariant} disabled={c.locked} />}
          <Text style={styles.hint}>Le calcul des chemins utilise FOSSGIS / OpenStreetMap. Vérifiez les accès et les règles locales.</Text>
          <Pressable testID="publish-walk" disabled={c.locked} style={[styles.primary, c.locked && styles.disabled]} onPress={publish}><Text style={[styles.text, styles.onBrand]}>Publier la balade{variants.length > 1 ? ` et ses ${variants.length} itinéraires` : ''}</Text></Pressable>
        </>}
        {!!c.error && <Text testID="create-error" accessibilityRole="alert" style={styles.error}>{c.error}</Text>}
        {!!c.notice && <Text testID="create-notice" accessibilityLiveRegion="polite" style={styles.notice}>{c.notice}</Text>}
        {!!c.busy && <View style={styles.row}><ActivityIndicator color={colors.brandPrimary} /><Text style={styles.hint}>{c.busy}</Text></View>}
        {step < 2 && <Pressable testID="next-step" disabled={c.locked} style={[styles.primary, c.locked && styles.disabled]} onPress={advance}><Text style={[styles.text, styles.onBrand]}>{step === 0 ? '2 · Affiner ce tracé' : '3 · Finaliser la balade'}</Text></Pressable>}
        {step > 0 && <Action id="previous-step" label={step === 1 ? 'Retour au tracé' : 'Retour aux retouches'} onPress={() => changeStep(step - 1)} disabled={c.locked} />}
      </View>
    </ScrollView>
    {note && <AnnotationEditor key={note.id} note={note} disabled={!!c.busy} onClose={() => setNote(null)} onSave={value => { c.saveAnnotation(value); setNote(null); }} onRemove={() => { c.removeAnnotation(note.id); setNote(null); }} />}
    {c.finishOpen && <FinishDialog open gap={rawGapToStart(c.draft)} busy={c.busy} error={c.error} onComplete={c.finishReturn} onContinue={c.continueRecording} />}
  </KeyboardAvoidingView>;
}

function structuredCopy<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }
function Action({ id, label, onPress, disabled }: { id: string; label: string; onPress: () => void; disabled: boolean }) {
  return <Pressable accessibilityRole="button" testID={id} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.small, (disabled || pressed) && styles.disabled]}><Text style={styles.text}>{label}</Text></Pressable>;
}
function Choices({ prefix, label, options, value, onChange }: { prefix: string; label: string; options: Record<string, string>; value: string; onChange: (value: string) => void }) {
  return <><Text style={styles.label}>{label}</Text><View style={styles.row}>{Object.entries(options).map(([key, text]) => <Pressable key={key} accessibilityRole="radio" accessibilityState={{ checked: value === key }} testID={`${prefix}-${key}`} onPress={() => onChange(key)} style={[styles.chip, value === key && styles.active]}><Text style={[styles.text, value === key && styles.onBrand]}>{text}</Text></Pressable>)}</View></>;
}

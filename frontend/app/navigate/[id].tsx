import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeepAwake } from 'expo-keep-awake';
import { ArrowBendUpLeft, ArrowBendUpRight, ArrowUUpLeft, ArrowUp, Flag, Warning } from 'phosphor-react-native';
import { api } from '../../src/api';
import { DoggoMap } from '../../src/DoggoMap';
import type { MarkerInput, SegmentInput } from '../../src/maps/types';
import { observeLiveMapLocation, useLiveMapLocation } from '../../src/useLiveMapLocation';
import { buildNavigation, initialProgress, projectOnRoute, updateProgress } from '../../src/navigation';
import { formatMeters, meters, regionFor } from '../../src/routeDraft';
import { walkColor } from '../../src/labels';
import { AnnotationEditor } from '../../src/create/AnnotationEditor';
import { dangerOptions, interestOptions } from '../../src/create/routeMetadata';
import type { RouteNote } from '../../src/create/routeMetadata';
import { colors } from '../../src/theme';

type Report = { id?: string; type: string; lat: number; lng: number; description?: string; status?: 'active' | 'resolved'; index?: number };
type SavedRoute = {
  segments: { coordinates: [number, number][]; freedom: SegmentInput['freedom']; off_path?: boolean }[];
  hazards?: Report[];
  pois?: Report[];
};
type WalkData = {
  walk: SavedRoute & { id: string; title: string; environment: string; dog_freedom: string; variants?: (SavedRoute & { name: string })[] };
  hazards: Report[];
  pois: Report[];
};

const reportKey = (report: Report) => report.id || `variant-${report.index}`;
const coordinateOf = (report: Report) => ({ latitude: report.lat, longitude: report.lng });
const reportLabel = (report: Report) => report.type === 'event' ? 'Événement sur le parcours' : dangerOptions[report.type] || 'Danger signalé';

export default function NavigationPage() {
  const { id, variant = 'A' } = useLocalSearchParams<{ id: string; variant?: string }>();
  return <WalkNavigation key={`${id}:${variant}`} id={id} variant={variant} />;
}

function WalkNavigation({ id, variant }: { id: string; variant: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const gps = useLiveMapLocation();
  const [data, setData] = useState<WalkData>();
  const [loadError, setLoadError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [progress, setProgress] = useState(initialProgress);
  const [follow, setFollow] = useState(true);
  const [view, setView] = useState(0);
  const [reports, setReports] = useState<Report[]>([]);
  const [answered, setAnswered] = useState<string[]>([]);
  const [note, setNote] = useState<RouteNote>();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [reportError, setReportError] = useState('');
  const [stopOpen, setStopOpen] = useState(false);
  const saving = useRef(false);
  const reportRevision = useRef(0);

  const mergeReports = useCallback((result: WalkData) => {
    const selected = result.walk.variants?.find(route => route.name === variant);
    return [...(result.hazards || []), ...(selected?.hazards || []).map((report, index) => ({ ...report, index }))];
  }, [variant]);

  useEffect(() => {
    let active = true;
    void api(`/walks/${encodeURIComponent(id)}`).then((result: WalkData) => {
      if (!active) return;
      setData(result);
      setReports(mergeReports(result));
    }).catch(error => { if (active) setLoadError(error.message); });
    return () => { active = false; };
  }, [id, mergeReports, loadAttempt]);

  useEffect(() => {
    if (!data || progress.arrived) return;
    let active = true;
    const interval = setInterval(async () => {
      const revision = reportRevision.current;
      try {
        const result: WalkData = await api(`/walks/${encodeURIComponent(id)}`);
        if (active && !saving.current && revision === reportRevision.current) setReports(mergeReports(result));
      } catch { /* Keep the last known reports when reception drops. */ }
    }, 30000);
    return () => { active = false; clearInterval(interval); };
  }, [data, id, mergeReports, progress.arrived]);

  const selected = data?.walk.variants?.find(route => route.name === variant);
  const saved = variant === 'A' ? data?.walk : selected;
  const segments = useMemo<SegmentInput[]>(() => (saved?.segments || []).map(segment => ({
    freedom: segment.freedom, offPath: segment.off_path,
    coordinates: segment.coordinates.map(([latitude, longitude]) => ({ latitude, longitude })),
  })), [saved]);
  const route = useMemo(() => buildNavigation(segments), [segments]);
  const region = useMemo(() => regionFor({ start: segments[0]?.coordinates[0] || null, legs: segments.map(segment => ({ ...segment, source: 'draw' })) }), [segments]);
  const precise = gps.status === 'live' && gps.coordinate && gps.accuracy !== null && gps.accuracy <= 35;

  useEffect(() => {
    if (!route.edges.length) return;
    return observeLiveMapLocation(({ coordinate, accuracy, status }) => {
      if (status !== 'live' || !coordinate || accuracy === null || accuracy > 35) return;
      setProgress(previous => updateProgress(route, previous, coordinate, accuracy));
    });
  }, [route]);

  const onMapGesture = useCallback(() => setFollow(false), []);
  const start = segments[0]?.coordinates[0];
  const hazards = useMemo(() => reports.filter(report => report.status !== 'resolved')
    .map(report => ({ report, match: projectOnRoute(route, coordinateOf(report)) }))
    .filter(({ match }) => match && match.gap <= 45), [reports, route]);
  const markers = useMemo<MarkerInput[]>(() => {
    if (!start || !data) return [];
    const pois = selected?.pois || data.pois || [];
    return [
      { id: 'departure', coordinate: start, color: walkColor(data.walk), icon: { kind: 'walk' }, label: 'Départ' },
      ...pois.map((poi, i): MarkerInput => ({ id: `poi-${i}`, coordinate: coordinateOf(poi), icon: { kind: 'poi', type: poi.type }, color: colors.brandSecondary, label: interestOptions[poi.type] })),
      ...hazards.map(({ report }): MarkerInput => ({ id: reportKey(report), coordinate: coordinateOf(report), icon: { kind: 'hazard', type: report.type }, color: colors.error, label: reportLabel(report) })),
    ];
  }, [data, hazards, selected, start]);

  const nearby = precise && gps.coordinate && !progress.arrived && hazards
    .filter(({ report }) => !answered.includes(reportKey(report)))
    .map(({ report }) => ({ report, distance: meters(gps.coordinate!, coordinateOf(report)) }))
    .filter(({ distance }) => distance <= 65)
    .sort((a, b) => a.distance - b.distance)[0];

  const respond = async (report: Report, choice: 'confirm' | 'resolve' | 'skip') => {
    if (saving.current) return;
    const key = reportKey(report);
    if (choice === 'skip') { setAnswered(previous => [...previous, key]); setFeedback(''); return; }
    saving.current = true;
    setBusy(true);
    setFeedback('');
    try {
      const url = report.id ? `/hazards/${encodeURIComponent(report.id)}` : `/walks/${encodeURIComponent(id)}/variants/${encodeURIComponent(variant)}/hazards/${report.index}`;
      await api(`${url}/${choice}`, { method: 'POST' });
      reportRevision.current++;
      setAnswered(previous => [...previous, key]);
      if (choice === 'resolve') setReports(previous => previous.map(item => reportKey(item) === key ? { ...item, status: 'resolved' } : item));
      setFeedback(choice === 'confirm' ? 'Danger confirmé.' : 'Signalement indiqué comme disparu.');
    } catch { setFeedback('Réponse non envoyée. Réessaie quand le réseau revient.'); }
    finally { saving.current = false; setBusy(false); }
  };

  const openReport = () => {
    if (!precise || !gps.coordinate) return;
    setReportError('');
    setNote({ id: 'live', kind: 'hazard', type: 'event', coordinate: gps.coordinate, description: '' });
  };
  const submitReport = async (value: RouteNote) => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setReportError('');
    try {
      const report: Report = await api(`/walks/${encodeURIComponent(id)}/hazards`, {
        method: 'POST',
        body: JSON.stringify({ type: value.type, description: value.description.trim(), lat: value.coordinate.latitude, lng: value.coordinate.longitude }),
      });
      reportRevision.current++;
      setReports(previous => [...previous, report]);
      setAnswered(previous => [...previous, reportKey(report)]);
      setFeedback('Signalement ajouté.');
      setNote(undefined);
    } catch { setReportError('Signalement non envoyé. Tu peux réessayer.'); }
    finally { saving.current = false; setBusy(false); }
  };

  if (!data || !route.edges.length || !start) return <View style={[styles.center, { paddingTop: insets.top }]}>
    {!data && !loadError ? <ActivityIndicator color={colors.brandPrimary} /> : <>
      <Text style={styles.text}>{loadError || 'Cet itinéraire ne contient aucun tracé utilisable.'}</Text>
      {!!loadError && <Button label="Réessayer" onPress={() => { setLoadError(''); setLoadAttempt(value => value + 1); }} />}
    </>}
    <Button label="Retour" onPress={() => router.back()} />
  </View>;

  const next = route.turns.find(turn => turn.at >= progress.along - 3);
  const toStart = gps.coordinate ? meters(gps.coordinate, start) : null;
  const remaining = Math.max(0, route.total - progress.along);
  const distance = next ? Math.max(0, next.at - progress.along) : remaining;
  const turnText = next?.side === 'left' ? 'Tourne à gauche' : next?.side === 'right' ? 'Tourne à droite' : 'Fais demi-tour';
  const title = progress.arrived ? 'Balade terminée' : !precise ? 'Position GPS en attente' : !progress.started ? 'Rejoins le départ'
    : progress.offRoute ? 'Rejoins le tracé' : next ? turnText : 'Continue jusqu’à l’arrivée';
  const subtitle = progress.arrived ? 'Tu es arrivé à la fin de l’itinéraire.'
    : !precise ? 'Le guidage reprend avec une position suffisamment précise.'
    : !progress.started ? `Départ à ${formatMeters(toStart!)} à vol d’oiseau`
    : progress.offRoute ? 'Suis le tracé affiché sur la carte pour reprendre le guidage.'
    : distance <= 8 && next ? 'Maintenant' : `Dans ${formatMeters(distance)}`;
  const Direction = progress.arrived || (!next && precise && progress.started && !progress.offRoute) ? Flag
    : !precise || !progress.started || progress.offRoute ? ArrowUp
    : next?.side === 'left' ? ArrowBendUpLeft : next?.side === 'right' ? ArrowBendUpRight : ArrowUUpLeft;
  const camera = follow && gps.status === 'live' && gps.coordinate && !progress.arrived
    ? { id: -(gps.timestamp * 1000 + view), coordinate: gps.coordinate, zoom: 18 } : undefined;
  const laterMatch = precise && gps.coordinate && progress.offRoute
    ? projectOnRoute(route, gps.coordinate, Math.min(route.total, progress.along + 90)) : undefined;
  const canResumeHere = laterMatch && laterMatch.gap <= 18 && laterMatch.along < route.total - 15;

  return <View style={[styles.screen, { paddingTop: insets.top }]}>
    {!progress.arrived && <NavigationKeepAwake />}
    <View style={styles.guidance} accessibilityLiveRegion="polite">
      <Direction size={34} weight="bold" color={colors.onBrand} />
      <View style={styles.flex}>
        <Text style={styles.walkName} numberOfLines={1}>{data.walk.title}{variant !== 'A' ? ` · ${variant}` : ''}</Text>
        <Text style={styles.title} testID="navigation-instruction">{title}</Text>
        <Text style={styles.onBrand}>{subtitle}</Text>
      </View>
    </View>
    <DoggoMap testID="navigation-map" initialRegion={region} segments={segments} markers={markers}
      fitToRoute fitRevision={view} locationFocus={camera} onMapGesture={onMapGesture} />
    {nearby && !note && !stopOpen && <View style={styles.card} testID="navigation-hazard-prompt">
      <View style={styles.row}><Warning size={20} color={colors.error} weight="fill" />
        <Text style={styles.text}>{reportLabel(nearby.report)} · à {formatMeters(nearby.distance)}</Text></View>
      {!!nearby.report.description && <Text style={styles.muted} numberOfLines={2}>{nearby.report.description}</Text>}
      <Text style={styles.muted}>Vois-tu encore ce danger ou cet événement ?</Text>
      <View style={styles.row}>
        <Button label="Toujours présent" disabled={busy} onPress={() => respond(nearby.report, 'confirm')} />
        <Button label="Disparu" disabled={busy} onPress={() => respond(nearby.report, 'resolve')} />
        <Button label="Passer" disabled={busy} onPress={() => respond(nearby.report, 'skip')} />
      </View>
    </View>}
    {stopOpen && <View style={styles.card}>
      <Text style={styles.text}>Arrêter la navigation ?</Text>
      <View style={styles.row}><Button label="Arrêter" onPress={() => router.back()} /><Button label="Continuer" onPress={() => setStopOpen(false)} /></View>
    </View>}
    <View style={[styles.footer, { paddingBottom: Math.max(10, insets.bottom) }]}>
      {!!feedback && <Text style={styles.muted} accessibilityLiveRegion="polite">{feedback}</Text>}
      <Text style={styles.text} testID="navigation-progress">{formatMeters(remaining)} restant · {Math.round(progress.along / route.total * 100)} %</Text>
      {canResumeHere && <Button label="Reprendre le guidage ici"
        onPress={() => setProgress({ started: true, along: laterMatch.along, offRoute: false, arrived: false })} />}
      <View style={styles.row}>
        {progress.arrived ? <Button label="Fermer" onPress={() => router.back()} /> : <>
          <Button label={follow ? 'Vue d’ensemble' : 'Suivre le GPS'} onPress={() => { setFollow(!follow); setView(value => value + 1); }} />
          <Button label="Signaler ici" primary disabled={!precise || busy} onPress={openReport} />
          <Button label="Quitter" onPress={() => setStopOpen(true)} />
        </>}
      </View>
    </View>
    {note && <AnnotationEditor note={note} onClose={() => { if (!saving.current) setNote(undefined); }}
      onSave={submitReport} disabled={busy} liveReport error={reportError} />}
  </View>;
}

function NavigationKeepAwake() {
  useKeepAwake(undefined, { suppressDeactivateWarnings: true });
  return null;
}

function Button({ label, onPress, disabled, primary }: { label: string; onPress: () => void; disabled?: boolean; primary?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}
    style={[styles.button, primary && styles.primary, disabled && styles.disabled]}>
    <Text style={[styles.text, primary && styles.onBrand]}>{label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.brandPrimary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 16, backgroundColor: colors.surface },
  flex: { flex: 1 },
  guidance: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, minHeight: 94 },
  walkName: { color: colors.brandTertiary, fontSize: 12, fontWeight: '600' },
  title: { color: colors.onBrand, fontSize: 22, fontWeight: '800' },
  onBrand: { color: colors.onBrand },
  footer: { padding: 10, gap: 6, backgroundColor: colors.surface, borderTopWidth: 1, borderColor: colors.border },
  card: { padding: 10, gap: 5, backgroundColor: colors.surfaceSecondary, borderTopWidth: 1, borderColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  button: { minHeight: 42, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 9, backgroundColor: colors.surfaceTertiary },
  primary: { backgroundColor: colors.brandPrimary },
  disabled: { opacity: .45 },
  text: { color: colors.onSurface, fontWeight: '700', fontSize: 14 },
  muted: { color: colors.muted, fontSize: 13 },
});

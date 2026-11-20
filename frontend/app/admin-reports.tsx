import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../src/api';
import { useAuth } from '../src/AuthContext';
import { reportReasons, type ReportReason } from '../src/WalkFeedback';
import { colors, radius, spacing } from '../src/theme';

type Status = 'published' | 'correction_requested' | 'hidden';
type Report = { id: string; walk_id: string; variant: string; route_revision: string; change_type: ReportReason; note?: string; reported_at: string };
type Walk = { id: string; title: string; edit_revision?: string; route_revision?: string; variants?: { name: string; route_revision?: string }[];
  moderation_status?: Status; moderation_note?: string };
type Queue = { walks: Walk[]; reports: Report[] };

const statusLabels: Record<Status, string> = { published: 'Visible', correction_requested: 'Correction demandée', hidden: 'Masquée' };

export default function AdminReports() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [queue, setQueue] = useState<Queue>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<{ walk: Walk; status: Status }>();
  const [note, setNote] = useState('');

  const load = useCallback(async () => setQueue(await api('/admin/walk-reports')), []);
  useFocusEffect(useCallback(() => {
    if (user?.can_moderate) void load().catch(e => setError(e.message));
  }, [load, user?.can_moderate]));

  const run = async (url: string, opts: RequestInit) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api(url, opts);
      setAction(undefined);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Action impossible.'); }
    finally { setBusy(false); }
  };
  const moderate = (walk: Walk, status: Status) => {
    setNote(walk.moderation_note ?? '');
    setAction({ walk, status });
  };
  const save = () => {
    if (!action) return;
    void run(`/admin/walks/${encodeURIComponent(action.walk.id)}/moderation`, {
      method: 'PUT', body: JSON.stringify({ status: action.status, edit_revision: action.walk.edit_revision ?? 'initial', note: note.trim() }),
    });
  };

  return <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.lg }]}>
    <Button label="‹ Retour" onPress={() => router.back()} />
    <Text style={styles.title}>Signalements des balades</Text>
    {!!error && <Text accessibilityRole="alert" style={{ color: colors.error }}>{error}</Text>}
    {!user?.can_moderate ? <Text style={styles.text}>Accès réservé aux administrateurs.</Text>
      : !queue && !error ? <ActivityIndicator color={colors.brandPrimary} />
      : queue?.walks.length === 0 ? <Text style={styles.text}>Aucun signalement ouvert.</Text>
      : queue?.walks.map(walk => {
        const status = walk.moderation_status ?? 'published';
        return <View key={walk.id} style={styles.card}>
          <Text style={styles.heading}>{walk.title}</Text>
          <Text style={styles.muted}>{statusLabels[status]}</Text>
          {!!walk.moderation_note && <Text style={styles.text}>{walk.moderation_note}</Text>}
          {queue.reports.filter(report => report.walk_id === walk.id).map(report => {
            const route = report.variant === 'A' ? walk : walk.variants?.find(variant => variant.name === report.variant);
            return (
            <View key={report.id} style={styles.report}>
              <Text style={styles.text}>{reportReasons[report.change_type]} · {report.variant}</Text>
              <Text style={styles.muted}>{new Date(report.reported_at).toLocaleDateString('fr-FR')}{!route || report.route_revision !== (route.route_revision ?? 'initial') ? ' · Ancienne version' : ''}</Text>
              {!!report.note && <Text style={styles.text}>{report.note}</Text>}
              <Button label="Clore le signalement" disabled={busy}
                onPress={() => void run(`/admin/walk-reports/${encodeURIComponent(report.id)}/dismiss`, { method: 'POST' })} />
            </View>
            );
          })}
          <View style={styles.row}>
            <Button label="Voir la balade" onPress={() => router.push({ pathname: '/walk/[id]', params: { id: walk.id } })} />
            {status !== 'hidden' && <Button label="Demander une correction" disabled={busy} onPress={() => moderate(walk, 'correction_requested')} />}
            {status !== 'hidden' && <Button label="Masquer" disabled={busy} onPress={() => moderate(walk, 'hidden')} />}
            {status !== 'published' && <Button label={status === 'hidden' ? 'Rendre visible' : 'Lever la demande'} disabled={busy} onPress={() => moderate(walk, 'published')} />}
          </View>
          {action?.walk.id === walk.id && <View style={styles.report}>
            {action.status !== 'published' && <TextInput accessibilityLabel="Message à l’auteur" placeholder="Message à l’auteur"
              placeholderTextColor={colors.muted} maxLength={500} value={note} onChangeText={setNote} style={styles.input} multiline />}
            <View style={styles.row}>
              <Button label="Valider" disabled={busy || (action.status === 'correction_requested' && !note.trim())} onPress={save} />
              <Button label="Annuler" disabled={busy} onPress={() => setAction(undefined)} />
            </View>
          </View>}
        </View>;
      })}
    {user?.can_moderate && <Button label="Actualiser" disabled={busy} onPress={() => {
      setError(''); void load().catch(e => setError(e.message));
    }} />}
  </ScrollView>;
}

function Button({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} style={[styles.button, disabled && { opacity: 0.5 }]} onPress={onPress}>
    <Text style={{ color: colors.brandPrimary, fontWeight: '600' }}>{label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.lg, gap: spacing.md },
  title: { fontSize: 24, fontWeight: '700', color: colors.onSurface },
  heading: { fontSize: 18, fontWeight: '700', color: colors.onSurface },
  text: { color: colors.onSurface },
  muted: { color: colors.muted },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  report: { borderTopWidth: 1, borderColor: colors.border, paddingTop: spacing.sm, gap: spacing.xs },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  button: { alignSelf: 'flex-start', padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  input: { padding: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, color: colors.onSurface },
});

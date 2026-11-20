import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from './api';
import { colors, radius, spacing } from './theme';

export const reportReasons = {
  path_inaccessible: 'Passage inaccessible',
  rules_changed: 'Accès ou règles pour les chiens',
  new_hazard: 'Danger ou obstacle',
  hazard_disappeared: 'Danger disparu',
  new_poi: 'Point d’intérêt à ajouter',
  other: 'Autre problème',
};
export type ReportReason = keyof typeof reportReasons;

export function WalkFeedback({ walkId, variant, revision, canConfirm, onClose, onDone }: {
  walkId: string; variant: string; revision: string; canConfirm: boolean;
  onClose: () => void; onDone: (accurate: boolean) => void;
}) {
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState<ReportReason>();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (accurate: boolean) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api(`/walks/${encodeURIComponent(walkId)}/confirm`, {
        method: 'POST', body: JSON.stringify({ accurate, variant, route_revision: revision,
          ...(accurate ? {} : { change_type: reason, note: note.trim() }) }),
      });
      onDone(accurate);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Retour non envoyé. Réessayez.');
    } finally { setBusy(false); }
  };
  const close = () => { if (!busy) onClose(); };

  return <Modal transparent animationType="slide" onRequestClose={close}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          <Text style={styles.title}>{canConfirm ? 'Le parcours était-il conforme ?' : 'Signaler un problème'} · {variant}</Text>
          {canConfirm && <Pressable testID="confirm-accurate" accessibilityRole="button" disabled={busy} style={styles.primary} onPress={() => void submit(true)}>
            <Text style={styles.onBrand}>Oui, le parcours était conforme</Text>
          </Pressable>}
          {canConfirm && <Text style={styles.text}>Signaler un problème</Text>}
          {(Object.keys(reportReasons) as ReportReason[]).map(key => <Pressable key={key} testID={`change-${key}`}
            accessibilityRole="radio" accessibilityState={{ checked: reason === key }} disabled={busy} onPress={() => setReason(key)}
            style={[styles.option, reason === key && styles.selected]}><Text style={styles.text}>{reportReasons[key]}</Text></Pressable>)}
          {reason && <>
            <TextInput accessibilityLabel="Détail du signalement" placeholder="Précisez l’endroit ou le problème (facultatif)"
              placeholderTextColor={colors.muted} style={styles.option} value={note} onChangeText={setNote} maxLength={500} editable={!busy} multiline />
            <Pressable accessibilityRole="button" disabled={busy} style={styles.primary} onPress={() => void submit(false)}><Text style={styles.onBrand}>Envoyer le signalement</Text></Pressable>
          </>}
          {!!error && <Text accessibilityRole="alert" style={{ color: colors.error }}>{error}</Text>}
          <Pressable accessibilityRole="button" disabled={busy} onPress={close} style={styles.option}><Text style={styles.text}>Fermer</Text></Pressable>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0007' },
  sheet: { maxHeight: '88%', backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  content: { padding: spacing.lg, gap: spacing.sm },
  title: { color: colors.onSurface, fontSize: 19, fontWeight: '700' },
  text: { color: colors.onSurface },
  option: { padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, color: colors.onSurface },
  selected: { borderColor: colors.brandPrimary, backgroundColor: colors.surfaceSecondary },
  primary: { padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.brandPrimary },
  onBrand: { color: colors.onBrand, fontWeight: '700' },
});

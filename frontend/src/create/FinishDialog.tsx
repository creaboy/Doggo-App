import React from 'react';
import { View, Text, Modal, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { colors } from '../theme';
import { formatMeters } from '../routeDraft';
import { styles } from './styles';

export function FinishDialog({ open, gap, busy, error, onComplete, onContinue }: {
  open: boolean; gap: number; busy: string; error: string; onComplete: () => void; onContinue: () => void;
}) {
  return <Modal visible={open} transparent animationType="fade" onRequestClose={() => !busy && onContinue()}>
    <View style={styles.overlay} testID="finish-dialog"><View style={styles.dialog}><ScrollView contentContainerStyle={{ gap: 16 }}>
      <Text style={styles.title} testID="finish-dialog-title">Rejoindre le départ</Text>
      <Text style={styles.text} testID="finish-distance">Vous êtes encore à {formatMeters(gap)} de votre point de départ. Les balades Doggo se terminent là où elles ont commencé.</Text>
      <Text style={styles.hint} testID="finish-explanation">L’enregistrement est en pause. Vous pourrez vérifier le retour calculé avant toute publication.</Text>
      {!!error && <Text testID="finish-error" style={styles.error} accessibilityRole="alert">{error}</Text>}
      <Pressable testID="complete-route-to-start" disabled={!!busy} style={[styles.primary, !!busy && styles.disabled]} onPress={onComplete}>
        {busy ? <ActivityIndicator color={colors.onBrand} /> : null}<Text style={[styles.text, styles.onBrand]}>{busy || 'Compléter le trajet jusqu’au départ'}</Text>
      </Pressable>
      <Pressable testID="continue-recording" disabled={!!busy} style={styles.small} onPress={onContinue}><Text style={styles.text}>Continuer l’enregistrement</Text></Pressable>
      <Pressable testID="cancel-finish" disabled={!!busy} style={styles.small} onPress={onContinue}><Text style={styles.hint}>Annuler et reprendre la balade</Text></Pressable>
    </ScrollView></View></View>
  </Modal>;
}
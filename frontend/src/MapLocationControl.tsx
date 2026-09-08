import React from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Crosshair } from 'phosphor-react-native';
import { colors } from './theme';

export function MapLocationControl({ prefix, status, onPress }: { prefix: string; status: string; onPress: () => void }) {
  const message = status === 'denied' ? 'Autorisez la localisation pour voir votre position.'
    : status === 'unavailable' ? 'GPS indisponible. Touchez la cible pour réessayer.'
    : status === 'stale' ? 'Dernière position connue · GPS en attente' : '';
  return <View style={styles.overlay} pointerEvents="box-none">
    <Pressable testID={`${prefix}-my-location`} accessibilityRole="button" accessibilityLabel="Recentrer sur ma position GPS"
      onPress={onPress} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
      {status === 'loading' ? <ActivityIndicator testID={`${prefix}-location-loading`} color={colors.location} /> : <Crosshair size={24} color={status === 'live' ? colors.location : colors.muted} weight="bold" />}
    </Pressable>
    {!!message && <Text testID={`${prefix}-location-status`} accessibilityLiveRegion="polite" style={styles.message}>{message}</Text>}
  </View>;
}
const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 12, right: 12, alignItems: 'flex-end', maxWidth: '85%', gap: 8, zIndex: 100 },
  button: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  pressed: { opacity: .65 },
  message: { fontSize: 12, lineHeight: 17, color: colors.onSurface, backgroundColor: colors.surfaceSecondary, padding: 9, borderRadius: 8, maxWidth: 260 },
});
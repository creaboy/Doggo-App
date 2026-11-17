import React, { useState } from 'react';
import { Modal, View, Text, TextInput, ScrollView, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { RouteNote } from './routeMetadata';
import { interestOptions, dangerOptions } from './routeMetadata';
import { styles } from './styles';
import { colors } from '../theme';

export function AnnotationEditor({ note, onSave, onRemove, onClose, disabled, liveReport, error }: {
  note: RouteNote; onSave: (value: RouteNote) => void; onRemove?: () => void; onClose: () => void; disabled: boolean;
  liveReport?: boolean; error?: string;
}) {
  const [value, setValue] = useState(note);
  const insets = useSafeAreaInsets();
  const options = liveReport ? { event: 'Événement sur le parcours', ...dangerOptions } : value.kind === 'poi' ? interestOptions : dangerOptions;
  return <Modal visible transparent animationType="slide" onRequestClose={onClose}>
    <View style={[styles.overlay, { paddingBottom: insets.bottom + 20 }]}><View style={styles.dialog} testID="annotation-editor">
      <Text style={styles.title}>{liveReport ? 'Signaler ici' : 'Repère sur la carte'}</Text>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 14 }}>
        {!liveReport && <View style={styles.row}>{(['poi', 'hazard'] as const).map(kind => <Pressable key={kind} testID={`annotation-kind-${kind}`}
          style={[styles.mode, value.kind === kind && styles.active]} onPress={() => setValue({ ...value, kind, type: 'other' })}>
          <Text style={[styles.text, value.kind === kind && styles.onBrand]}>{kind === 'poi' ? 'Point d’intérêt' : 'Danger / obstacle'}</Text>
        </Pressable>)}</View>}
        <View style={styles.row}>{Object.entries(options).map(([type, label]) => <Pressable key={type} testID={`annotation-type-${type}`}
          style={[styles.chip, value.type === type && styles.active]} onPress={() => setValue({ ...value, type })}>
          <Text style={[styles.text, value.type === type && styles.onBrand]}>{label}</Text>
        </Pressable>)}</View>
        <TextInput testID="annotation-description" accessibilityLabel="Précisions sur ce repère" placeholder="Précisions : accès, obstacle, conseils…" placeholderTextColor={colors.muted} maxLength={3000}
          multiline style={[styles.input, { minHeight: 80 }]} value={value.description} onChangeText={description => setValue({ ...value, description })} />
        <Text style={styles.hint}>{value.coordinate.latitude.toFixed(5)}, {value.coordinate.longitude.toFixed(5)}</Text>
        {!!error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
        <Pressable testID="save-annotation" disabled={disabled} style={[styles.primary, disabled && styles.disabled]} onPress={() => onSave(value)}><Text style={[styles.text, styles.onBrand]}>{liveReport ? 'Envoyer le signalement' : 'Enregistrer le repère'}</Text></Pressable>
        <View style={styles.row}>{onRemove && <Pressable testID="remove-annotation" disabled={disabled} style={styles.small} onPress={onRemove}><Text style={styles.error}>Supprimer</Text></Pressable>}
          <Pressable testID="cancel-annotation" disabled={disabled} style={styles.small} onPress={onClose}><Text style={styles.text}>Annuler</Text></Pressable></View>
      </ScrollView>
    </View></View>
  </Modal>;
}

import React, { useMemo } from 'react';
import { View, Text, Modal, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DoggoMap, LatLng } from '../DoggoMap';
import { colors, spacing } from '../theme';
import { Draft, Freedom, legDistance, regionFor, routeMarkers, stats } from '../routeDraft';
import { SegmentPicker } from './SegmentPicker';
import { styles } from './styles';
import { SegmentEditor, SegmentSelection } from './SegmentEditor';

export function RoutePreview({ open, draft, duration, title, error, busy, onBack, onPublish, onFreedom, selection, onSelect, onSplit, onCloseSelection, onUndo, canUndo }: {
  open: boolean; draft: Draft; duration: string; title: string; error: string; busy: string;
  onBack: () => void; onPublish: () => void; onFreedom: (index: number, value: Freedom) => void;
  selection: SegmentSelection; onSelect: (index: number, point?: LatLng) => void; onSplit: () => void; onCloseSelection: () => void; onUndo: () => void; canUndo: boolean;
}) {
  const insets = useSafeAreaInsets();
  const totals = stats(draft);
  const region = useMemo(() => regionFor(draft), [draft]);
  const generated = draft.legs.some(l => l.generated);
  return <Modal visible={open} animationType="slide" onRequestClose={() => !busy && onBack()}>
    <View style={[styles.root, { paddingTop: insets.top }]} testID="route-preview">
      <View style={styles.previewHeader}><Pressable testID="edit-route" disabled={!!busy} style={[styles.small, { alignSelf: 'flex-start' }]} onPress={onBack}><Text style={styles.text}>Retour au tracé</Text></Pressable>
        <Text testID="preview-title" style={styles.title}>Votre boucle complète</Text>
        <Text testID="preview-loop-status" style={styles.notice}>Boucle terminée · départ = arrivée</Text>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}>
        <View style={styles.map}><DoggoMap testID="preview-map" initialRegion={region} segments={draft.legs} markers={routeMarkers(draft)} fitToRoute onSegmentPress={onSelect} selectedSegmentIndex={selection?.index} /></View>
        <View style={styles.section}>
          <Text testID="preview-walk-name" style={styles.text}>{title.trim() || 'Balade sans titre · renseignez les détails avant de publier'}</Text>
          <View style={styles.stats}>
            <View style={styles.stat}><Text style={styles.number} testID="preview-distance">{totals.distanceKm.toFixed(2)} km</Text><Text style={styles.hint}>Distance totale</Text></View>
            <View style={styles.stat}><Text style={styles.number} testID="preview-duration">{duration || '—'} min</Text><Text style={styles.hint}>Durée saisie</Text></View>
            <View style={styles.stat}><Text style={styles.number} testID="preview-off-leash">{totals.offLeashPct}%</Text><Text style={styles.hint}>Sans laisse</Text></View>
          </View>
          <Text testID="preview-start-coordinate" style={styles.hint}>Départ et arrivée : {draft.start?.latitude.toFixed(6)}, {draft.start?.longitude.toFixed(6)} · repère D</Text>
          {generated && <Text testID="generated-return-note" style={styles.notice}>Le retour ajouté par Doggo apparaît en pointillés. Par défaut : attention. Vérifiez son accès sur place.</Text>}
          <Text testID="preview-edit-instructions" style={styles.hint}>Touchez le tracé à l’endroit souhaité pour modifier une règle ou diviser le segment GPS en deux portions.</Text>
          <SegmentEditor prefix="preview-edit-segment" draft={draft} selection={selection} disabled={!!busy} recording={false}
            onFreedom={onFreedom} onSplit={onSplit} onClose={onCloseSelection} />
          <Pressable testID="preview-undo-edit" disabled={!!busy || !canUndo} style={[styles.small, (!canUndo || !!busy) && styles.disabled]} onPress={onUndo}><Text style={styles.text}>Annuler la dernière modification</Text></Pressable>
          <Text testID="preview-segment-legend" style={styles.hint}>Vert : libre · orange : prudence · rouge : laisse. Les couleurs indiquent les règles renseignées, pas une autorisation officielle.</Text>
          {draft.legs.map((leg, i) => <View key={leg.id || i} testID={`preview-segment-${i}`} style={styles.card}>
            <Pressable testID={`preview-select-segment-${i}`} style={styles.small} onPress={() => onSelect(i)}><Text style={styles.text}>Sélectionner cette portion</Text></Pressable>
            <Text testID={`preview-segment-label-${i}`} style={styles.text}>{leg.generated ? 'Retour ajouté par Doggo' : `Segment ${i + 1}`} · {(legDistance(leg) / 1000).toFixed(2)} km</Text>
            <SegmentPicker prefix={`segment-${i}-freedom`} value={leg.freedom} onChange={v => onFreedom(i, v)} disabled={!!busy} />
          </View>)}
          {!!error && <Text testID="preview-error" style={styles.error} accessibilityRole="alert">{error}</Text>}
          <Pressable testID="publish-walk" style={[styles.primary, !!busy && styles.disabled]} disabled={!!busy} onPress={onPublish}>
            {!!busy && <ActivityIndicator color={colors.onBrand} />}<Text style={[styles.text, styles.onBrand]}>{busy || 'Publier cette boucle'}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  </Modal>;
}
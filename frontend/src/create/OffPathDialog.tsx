import React from 'react';
import { Modal, View, Text, Pressable } from 'react-native';
import type { PathChoice, PathConfirmation } from '../routeCompletion';
import { formatMeters, legDistance } from '../routeDraft';
import { styles } from './styles';

export function OffPathDialog({ request, onAnswer }: { request: PathConfirmation; onAnswer: (value: PathChoice) => void }) {
  return <Modal visible transparent animationType="fade" onRequestClose={() => onAnswer('cancel')}>
    <View style={styles.overlay}><View style={styles.dialog} testID="off-path-dialog">
      <Text style={styles.dialogTitle}>{request.gps ? 'Conserver la trace GPS ?' : 'Confirmer ce passage libre ?'}</Text>
      <Text style={styles.text}>{request.gps ? 'Le recalage sur les chemins est indisponible pour cette portion. Vous pouvez conserver les positions enregistrées.'
        : `${formatMeters(legDistance(request.leg))} en ligne directe. Ce segment ne suivra pas les chemins.`}</Text>
      <Text style={styles.hint}>Il gardera la couleur du tracé et apparaîtra en pointillés.</Text>
      <Pressable testID="confirm-off-path" style={styles.primary} onPress={() => onAnswer('direct')}><Text style={[styles.text, styles.onBrand]}>{request.gps ? 'Conserver ma trace GPS' : 'Confirmer le passage libre'}</Text></Pressable>
      <Pressable testID="follow-paths" style={styles.small} onPress={() => onAnswer('paths')}><Text style={styles.text}>{request.gps ? 'Réessayer le recalage' : 'Suivre les chemins'}</Text></Pressable>
      <Pressable testID="cancel-off-path" style={styles.small} onPress={() => onAnswer('cancel')}><Text style={styles.hint}>Annuler ce segment</Text></Pressable>
    </View></View>
  </Modal>;
}

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Platform, ActivityIndicator, Linking } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import type { MapProps } from './DoggoMap';
import { colors, spacing } from './theme';
import { googleMapStyle, mapColors } from './mapStyle';
import HostedMap from './HostedMap';
import NativeGoogleMap from './NativeGoogleMap';

export function GoogleDoggoMap(props: MapProps & { fallback: React.ReactNode }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [fallback, setFallback] = useState(false);
  const native = Platform.OS !== 'web' && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient &&
    (Platform.OS === 'android' ? Constants.expoConfig?.extra?.googleNativeAndroid : Constants.expoConfig?.extra?.googleNativeIos);
  const url = `${Constants.expoConfig?.extra?.backendUrl || process.env.EXPO_PUBLIC_BACKEND_URL}/api/maps/view`;
  const sceneRevision = useRef(0);
  const scene = useMemo(() => ({
    sceneRevision: ++sceneRevision.current,
    initialRegion: props.initialRegion, segments: (props.segments || []).map(({ coordinates, freedom, generated, pending }) => ({ coordinates, freedom, generated, pending })),
    markers: (props.markers || []).map(({ id, coordinate, color, label }) => ({ id, coordinate, color, label })),
    fitToRoute: props.fitToRoute, fitRevision: props.fitRevision,
    segmentEditable: !!props.onSegmentPress, selectedSegmentIndex: props.selectedSegmentIndex,
    editable: !!props.onPress, colors: mapColors, mapStyle: googleMapStyle,
  }), [props.initialRegion, props.segments, props.markers, props.fitToRoute, props.fitRevision, props.onPress, props.onSegmentPress, props.selectedSegmentIndex]);
  const payload = useMemo(() => ({ ...scene, userCoordinate: props.userCoordinate, userAccuracy: props.userAccuracy, locationStale: props.locationStale, locationFocus: props.locationFocus }),
    [scene, props.userCoordinate, props.userAccuracy, props.locationStale, props.locationFocus]);
  useEffect(() => {
    if (native || loaded || fallback) return;
    const timeout = setTimeout(() => setFailed(true), 25000);
    return () => clearTimeout(timeout);
  }, [loaded, native, fallback]);
  if (fallback) return <View style={[styles.root, props.style]}>{props.fallback}<Text testID={`${props.testID}-fallback-notice`} style={styles.attribution}>Fond de secours OpenStreetMap / CARTO</Text></View>;
  return <View style={[styles.root, props.style]} testID={props.testID}>
    {native ? <NativeGoogleMap {...props} /> : <HostedMap url={url} payload={payload} testID={props.testID} onMessage={(m: any) => {
      if (m.type === 'loaded') { setLoaded(true); setFailed(false); }
      if (m.type === 'error') setFailed(true);
      if (m.type === 'press' && Number.isFinite(m.lat) && Number.isFinite(m.lng)) props.onPress?.({ latitude: m.lat, longitude: m.lng });
      if (m.type === 'markerPress') props.markers?.find(x => x.id === m.id)?.onPress?.();
      if (m.type === 'segmentPress' && Number.isInteger(m.index) && m.index >= 0 && m.index < (props.segments?.length || 0)) props.onSegmentPress?.(m.index, Number.isFinite(m.lat) && Number.isFinite(m.lng) ? { latitude: m.lat, longitude: m.lng } : undefined);
    }} />}
    {!loaded && !native && !failed && <View pointerEvents="none" style={styles.loading}><ActivityIndicator testID={`${props.testID}-loading`} color={colors.brandPrimary} /></View>}
    {failed && <View style={styles.errorBox} testID={`${props.testID}-error`}><Text style={styles.errorText}>Google Maps est indisponible. Votre parcours reste conservé.</Text>
      <Pressable testID={`${props.testID}-fallback`} style={styles.button} onPress={() => setFallback(true)}><Text style={styles.buttonText}>Utiliser la carte de secours</Text></Pressable></View>}
    {!!props.segments?.length && <Pressable testID={`${props.testID}-routing-attribution`} style={styles.credit} onPress={() => Linking.openURL('https://www.openstreetmap.org/fixthemap')}>
      <Text style={styles.attribution}>Tracés © OpenStreetMap · FOSSGIS · Corriger la carte</Text>
    </Pressable>}
  </View>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceTertiary, overflow: 'hidden' },
  loading: { position: 'absolute', top: 14, right: 72, padding: 8, backgroundColor: colors.surfaceSecondary, borderRadius: 16 },
  errorBox: { position: 'absolute', top: 12, left: 12, right: 12, backgroundColor: colors.surfaceSecondary, padding: spacing.md, borderRadius: 12 },
  errorText: { color: colors.error, fontSize: 13 }, button: { minHeight: 44, justifyContent: 'center' },
  buttonText: { color: colors.brandPrimary, fontWeight: '700' },
  credit: { minHeight: 44, justifyContent: 'center', backgroundColor: colors.surfaceSecondary },
  attribution: { fontSize: 10, color: colors.muted, textAlign: 'center', padding: 3 },
});
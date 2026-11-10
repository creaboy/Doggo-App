import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, View, Text, Pressable, Platform, StyleSheet, Linking } from "react-native";
import { colors } from "./theme";
import { FOCUS_DEFAULT_ZOOM, DEFAULT_REGION, buildMapDocument } from "./maps/leafletDocument";
import type { MapProps, MapMessage } from "./maps/types";
import MapSurface from "./maps/MapSurface";
import { useLiveMapLocation } from "./useLiveMapLocation";
import { MapLocationControl } from "./MapLocationControl";

export type { LatLng, Region, SegmentInput, MarkerInput, MapProps } from './maps/types';

export const DoggoMap: React.FC<MapProps> = (props) => {
  const gps = useLiveMapLocation();
  const [focus, setFocus] = useState<MapProps['locationFocus']>();
  const pendingFocus = useRef(false);
  const autoFocused = useRef(false);
  useEffect(() => {
    if (pendingFocus.current && gps.coordinate && gps.status === 'live') {
      pendingFocus.current = false;
      setFocus(previous => ({ id: (previous?.id || 0) + 1, coordinate: gps.coordinate! }));
    }
  }, [gps.coordinate, gps.status]);
  // Opening the app lands on the user's GPS position instead of a default city center.
  useEffect(() => {
    if (autoFocused.current || !props.focusUserOnLoad || gps.status !== 'live' || !gps.coordinate) return;
    autoFocused.current = true;
    setFocus(previous => ({ id: (previous?.id || 0) + 1, coordinate: gps.coordinate!, zoom: props.focusUserZoom || FOCUS_DEFAULT_ZOOM }));
  }, [props.focusUserOnLoad, props.focusUserZoom, gps.coordinate, gps.status]);
  const locate = () => {
    if (gps.coordinate) setFocus(previous => ({ id: (previous?.id || 0) + 1, coordinate: gps.coordinate!, zoom: previous?.zoom }));
    if (gps.status !== 'live') {
      pendingFocus.current = true;
      if (gps.status === 'denied' && Platform.OS !== 'web') void Linking.openSettings().catch(() => {});
      else gps.retry();
    }
  };
  const scene = useMemo(() => ({
    segments: props.segments?.map(({ coordinates, freedom, generated, pending }) => ({ coordinates, freedom, generated, pending })),
    markers: (props.markers || []).map(({ id, coordinate, color, label, badge, pointIndex }) => ({ id, coordinate, color, label, badge, pointIndex })),
    segmentEditable: !!props.onSegmentPress,
    selectedSegmentIndex: props.selectedSegmentIndex, selectedPointIndex: props.selectedPointIndex,
    fitToRoute: props.fitToRoute, fitRevision: props.fitRevision,
  }), [props.segments, props.markers, props.onSegmentPress, props.selectedSegmentIndex, props.selectedPointIndex, props.fitToRoute, props.fitRevision]);
  const payload = useMemo(() => ({ scene, userCoordinate: gps.coordinate, userAccuracy: gps.accuracy,
    locationStale: gps.status !== 'live', locationFocus: focus }), [scene, gps.coordinate, gps.accuracy, gps.status, focus]);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [html] = useState(() => buildMapDocument(props.initialRegion || DEFAULT_REGION));
  useEffect(() => {
    if (ready) return;
    const timer = setTimeout(() => setFailed(true), 20000);
    return () => clearTimeout(timer);
  }, [attempt, ready]);
  const onMessage = (message: MapMessage) => {
    if (message.type === 'error') { setFailed(true); return; }
    if (message.type === 'ready') { setReady(true); return; }
    if (message.type === 'tilesLoaded') { setFailed(false); return; }
    const { lat, lng } = message;
    const coordinate = typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)
      && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { latitude: lat, longitude: lng } : undefined;
    if (message.type === 'press' && coordinate) props.onPress?.(coordinate);
    if (message.type === 'segmentPress' && coordinate && Number.isInteger(message.index) && message.index! >= 0 && message.index! < (props.segments?.length || 0)) props.onSegmentPress?.(message.index!, coordinate);
    if (message.type === 'markerPress') props.markers?.find(marker => marker.id === message.id)?.onPress?.();
  };
  return <View style={[mapStyles.root, props.style]}>
    <MapSurface key={attempt} html={html} payload={payload} onMessage={onMessage} testID={props.testID || 'doggo-map'} />
    {!ready && !failed && <ActivityIndicator testID={`${props.testID}-loading`} style={mapStyles.loading} color={colors.brandPrimary} />}
    {failed && <View style={mapStyles.error} testID={`${props.testID}-error`}>
      <Text style={{ color: colors.error }}>Le fond de carte est indisponible. Votre tracé est conservé.</Text>
      <Pressable accessibilityRole="button" onPress={() => { setFailed(false); setReady(false); setAttempt(value => value + 1); }}>
        <Text style={mapStyles.retry}>Réessayer</Text>
      </Pressable>
    </View>}
    {!!props.segments?.length && <Pressable accessibilityRole="link" onPress={() => Linking.openURL('https://www.openstreetmap.org/fixthemap')}>
      <Text style={mapStyles.credit}>Tracés © OpenStreetMap · FOSSGIS · Corriger la carte</Text>
    </Pressable>}
    <MapLocationControl prefix={props.testID || 'doggo-map'} status={gps.status} onPress={locate} />
  </View>;
};
const mapStyles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden', backgroundColor: colors.surfaceTertiary },
  loading: { position: 'absolute', top: 16, left: 16 },
  error: { position: 'absolute', top: 12, left: 12, right: 72, padding: 12, borderRadius: 12, backgroundColor: colors.surfaceSecondary },
  retry: { color: colors.brandPrimary, paddingVertical: 12, fontWeight: '700' },
  credit: { fontSize: 10, color: colors.muted, textAlign: 'center', padding: 4 },
});

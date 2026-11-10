import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, View, Text, Pressable, Platform, StyleSheet, Linking } from "react-native";
import { colors } from "./theme";
import { FOCUS_DEFAULT_ZOOM, DEFAULT_REGION, buildMapDocument, voyagerAvailable } from "./maps/leafletDocument";
import type { MapProps, MapMessage, Basemap } from "./maps/types";
import MapSurface from "./maps/MapSurface";
import { useLiveMapLocation } from "./useLiveMapLocation";
import { MapLocationControl } from "./MapLocationControl";

export type { LatLng, Region, SegmentInput, MarkerInput, MapProps } from './maps/types';

export const DoggoMap: React.FC<MapProps> = (props) => {
  const gps = useLiveMapLocation();
  const [basemap, setBasemap] = useState<Basemap>('liberty');
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
  const payload = useMemo(() => ({ scene, basemap, userCoordinate: gps.coordinate, userAccuracy: gps.accuracy,
    locationStale: gps.status !== 'live', locationFocus: focus }), [scene, basemap, gps.coordinate, gps.accuracy, gps.status, focus]);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [mapLoading, setMapLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [initialRegion] = useState(props.initialRegion || DEFAULT_REGION);
  const html = useMemo(() => buildMapDocument(initialRegion), [initialRegion]);
  useEffect(() => {
    if (ready && !mapLoading) return;
    const timer = setTimeout(() => setError('Le fond de carte est indisponible. Votre tracé est conservé.'), 30000);
    return () => clearTimeout(timer);
  }, [attempt, ready, mapLoading, basemap]);
  const onMessage = (message: MapMessage) => {
    if (message.type === 'error') { setMapLoading(false); setError(message.message || 'Le fond de carte est indisponible. Votre tracé est conservé.'); return; }
    if (message.type === 'basemapLoading') { setMapLoading(true); setError(''); return; }
    if (message.type === 'ready') { setReady(true); return; }
    if (message.type === 'tilesLoaded') { setMapLoading(false); setError(''); return; }
    const { lat, lng } = message;
    const coordinate = typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)
      && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { latitude: lat, longitude: lng } : undefined;
    if (message.type === 'press' && coordinate) props.onPress?.(coordinate);
    if (message.type === 'segmentPress' && coordinate && Number.isInteger(message.index) && message.index! >= 0 && message.index! < (props.segments?.length || 0)) props.onSegmentPress?.(message.index!, coordinate);
    if (message.type === 'markerPress') props.markers?.find(marker => marker.id === message.id)?.onPress?.();
  };
  return <View style={[mapStyles.root, props.style]}>
    <MapSurface key={attempt} html={html} payload={payload} onMessage={onMessage} testID={props.testID || 'doggo-map'} />
    {(!ready || mapLoading) && !error && <ActivityIndicator testID={`${props.testID}-loading`} style={mapStyles.loading} color={colors.brandPrimary} />}
    {!!error && <View style={mapStyles.error} testID={`${props.testID}-error`}>
      <Text style={{ color: colors.error }}>{error}</Text>
      <Pressable accessibilityRole="button" onPress={() => { setError(''); setMapLoading(true); setReady(false); setAttempt(value => value + 1); }}>
        <Text style={mapStyles.retry}>Réessayer</Text>
      </Pressable>
    </View>}
    {!!props.segments?.length && <Pressable accessibilityRole="link" onPress={() => Linking.openURL('https://www.openstreetmap.org/fixthemap')}>
      <Text style={mapStyles.credit}>Tracés © OpenStreetMap · FOSSGIS · Corriger la carte</Text>
    </Pressable>}
    <View style={mapStyles.basemaps} accessibilityRole="radiogroup">
      {(['liberty', 'voyager'] as const).map(value => {
        const unavailable = value === 'voyager' && !voyagerAvailable();
        return <Pressable key={value} testID={`${props.testID}-basemap-${value}`} accessibilityRole="radio"
          aria-checked={basemap === value} accessibilityState={{ checked: basemap === value, disabled: unavailable }} disabled={unavailable}
          onPress={() => { if (value !== basemap) { setBasemap(value); setMapLoading(true); setError(''); } }}
          style={[mapStyles.basemap, basemap === value && mapStyles.selectedBasemap, unavailable && { opacity: .55 }]}>
          <Text style={{ color: basemap === value ? colors.onBrand : colors.onSurface, fontSize: 12 }}>
            {value === 'liberty' ? 'Liberty' : unavailable ? 'Voyager · clé requise' : 'CARTO Voyager'}
          </Text>
        </Pressable>;
      })}
    </View>
    <MapLocationControl prefix={props.testID || 'doggo-map'} status={gps.status} onPress={locate} />
  </View>;
};
const mapStyles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden', backgroundColor: colors.surfaceTertiary },
  loading: { position: 'absolute', top: 16, left: 16 },
  error: { position: 'absolute', top: 12, left: 12, right: 72, padding: 12, borderRadius: 12, backgroundColor: colors.surfaceSecondary },
  retry: { color: colors.brandPrimary, paddingVertical: 12, fontWeight: '700' },
  basemaps: { position: 'absolute', bottom: 38, left: 8, flexDirection: 'row', gap: 4 },
  basemap: { paddingHorizontal: 10, minHeight: 40, justifyContent: 'center', borderRadius: 10, backgroundColor: colors.surfaceSecondary },
  selectedBasemap: { backgroundColor: colors.brandPrimary },
  credit: { fontSize: 10, color: colors.muted, textAlign: 'center', padding: 4 },
});

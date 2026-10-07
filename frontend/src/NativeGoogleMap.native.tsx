import React, { useCallback, useEffect, useRef } from 'react';
import MapView, { Circle, Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import type { MapProps } from './DoggoMap';
import { FOCUS_DEFAULT_ZOOM, googleMapStyle, mapColors, zoomToDelta } from './mapStyle';
import { StyleSheet, Text, View } from 'react-native';

export default function NativeGoogleMap(props: MapProps) {
  const ref = useRef<MapView>(null);
  const latest = useRef(props); latest.current = props;
  const fitKey = useRef('');
  const focus = useCallback(() => {
    const location = latest.current.locationFocus;
    if (!location) return;
    const delta = zoomToDelta(location.zoom || FOCUS_DEFAULT_ZOOM);
    ref.current?.animateToRegion({ ...location.coordinate, latitudeDelta: delta, longitudeDelta: delta }, 250);
  }, []);
  // initialRegion only positions the map when it mounts; framing is explicit via fitToRoute/fitRevision.
  const fit = useCallback(() => {
    const data = latest.current;
    const coords = data.segments?.flatMap(s => s.coordinates) || [];
    if (!data.fitToRoute) { fitKey.current = ''; return; }
    const key = String(data.fitRevision === undefined ? 'initial' : data.fitRevision);
    if (coords.length > 1 && fitKey.current !== key) {
      fitKey.current = key;
      ref.current?.fitToCoordinates(coords, { edgePadding: { top: 44, bottom: 44, left: 44, right: 44 }, animated: false });
    }
  }, []);
  useEffect(fit, [fit, props.fitToRoute, props.fitRevision]);
  useEffect(focus, [focus, props.locationFocus?.id]);
  return <MapView ref={ref} testID={`${props.testID}-google-native`} style={styles.map} provider={PROVIDER_GOOGLE}
    initialRegion={props.initialRegion} onMapReady={() => { fit(); focus(); }} customMapStyle={googleMapStyle} showsPointsOfInterests showsBuildings
    showsUserLocation={false} toolbarEnabled={false} onPress={e => props.onPress?.(e.nativeEvent.coordinate)}>
    {props.segments?.map((s, i) => <React.Fragment key={i}>
      <Polyline testID={`${props.testID}-segment-${i}`} coordinates={s.coordinates}
        strokeColor={s.pending ? mapColors.caution : mapColors[s.freedom]} strokeWidth={props.selectedSegmentIndex === i ? 8 : 5} lineDashPattern={s.generated || s.pending ? [8, 8] : undefined} zIndex={8} />
      {!!props.onSegmentPress && <Polyline testID={`${props.testID}-select-segment-${i}`} coordinates={s.coordinates}
        strokeColor={`${mapColors.outline}00`} strokeWidth={44} tappable zIndex={9}
        onPress={e => props.onSegmentPress?.(i, e.nativeEvent.coordinate)} />}
    </React.Fragment>)}
    {props.markers?.map(m => {
      const selected = m.pointIndex !== undefined && m.pointIndex === props.selectedPointIndex;
      const size = selected ? 30 : 24;
      // Numbered route points use a custom pin so the selection is visible; other markers keep the native pin.
      if (!m.badge) return <Marker key={m.id} testID={`${props.testID}-marker-${m.id}`} coordinate={m.coordinate}
        title={m.label} pinColor={m.color} onPress={m.onPress} zIndex={20} />;
      return <Marker key={m.id} testID={`${props.testID}-marker-${m.id}`} coordinate={m.coordinate} title={m.label}
        anchor={{ x: .5, y: .5 }} onPress={m.onPress} zIndex={selected ? 30 : 20}>
        <View style={[styles.pin, { width: size, height: size, borderRadius: size / 2, backgroundColor: m.color || mapColors.free,
          borderColor: selected ? mapColors.selected : mapColors.outline }]}>
          <Text style={styles.pinText}>{m.badge}</Text>
        </View>
      </Marker>;
    })}
    {props.userCoordinate && <>
      <Circle testID={`${props.testID}-location-accuracy`} center={props.userCoordinate} radius={props.userAccuracy || 0} fillColor={`${mapColors.location}18`} strokeColor={`${mapColors.location}40`} strokeWidth={1} zIndex={1} />
      <Marker testID={`${props.testID}-user-position`} coordinate={props.userCoordinate} title="Votre position GPS" anchor={{ x: .5, y: .5 }} zIndex={1000} onPress={e => e.stopPropagation()}>
        <View style={[styles.dot, { backgroundColor: props.locationStale ? mapColors.locationStale : mapColors.location }]} />
      </Marker>
    </>}
  </MapView>;
}
const styles = StyleSheet.create({
  map: { flex: 1 },
  dot: { width: 20, height: 20, borderRadius: 10, borderWidth: 3, borderColor: mapColors.outline },
  pin: { alignItems: 'center', justifyContent: 'center', borderWidth: 3, boxSizing: 'border-box' } as any,
  pinText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
});

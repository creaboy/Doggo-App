import React, { useCallback, useEffect, useRef } from 'react';
import MapView, { Circle, Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import type { MapProps } from './DoggoMap';
import { googleMapStyle, mapColors } from './mapStyle';
import { StyleSheet, View } from 'react-native';

export default function NativeGoogleMap(props: MapProps) {
  const ref = useRef<MapView>(null);
  const latest = useRef(props); latest.current = props;
  const focus = useCallback(() => {
    const location = latest.current.locationFocus;
    if (location) ref.current?.animateToRegion({ ...location.coordinate, latitudeDelta: .004, longitudeDelta: .004 }, 250);
  }, []);
  const fit = useCallback(() => {
    const data = latest.current;
    const coords = data.segments?.flatMap(s => s.coordinates) || [];
    if (data.fitToRoute && coords.length > 1) ref.current?.fitToCoordinates(coords, { edgePadding: { top: 44, bottom: 44, left: 44, right: 44 }, animated: false });
    else if (data.initialRegion) ref.current?.animateToRegion(data.initialRegion, 250);
  }, []);
  useEffect(fit, [fit, props.initialRegion?.latitude, props.initialRegion?.longitude, props.initialRegion?.latitudeDelta, props.initialRegion?.longitudeDelta, props.fitToRoute, props.fitRevision]);
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
    {props.markers?.map(m => <Marker key={m.id} testID={`${props.testID}-marker-${m.id}`} coordinate={m.coordinate}
      title={m.label} pinColor={m.color} onPress={m.onPress} zIndex={20} />)}
    {props.userCoordinate && <>
      <Circle testID={`${props.testID}-location-accuracy`} center={props.userCoordinate} radius={props.userAccuracy || 0} fillColor={`${mapColors.location}18`} strokeColor={`${mapColors.location}40`} strokeWidth={1} zIndex={1} />
      <Marker testID={`${props.testID}-user-position`} coordinate={props.userCoordinate} title="Votre position GPS" anchor={{ x: .5, y: .5 }} zIndex={1000} onPress={e => e.stopPropagation()}>
        <View style={[styles.dot, { backgroundColor: props.locationStale ? mapColors.locationStale : mapColors.location }]} />
      </Marker>
    </>}
  </MapView>;
}
const styles = StyleSheet.create({ map: { flex: 1 }, dot: { width: 20, height: 20, borderRadius: 10, borderWidth: 3, borderColor: mapColors.outline } });
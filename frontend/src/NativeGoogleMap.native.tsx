import React, { useCallback, useEffect, useRef } from 'react';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import type { MapProps } from './DoggoMap';
import { googleMapStyle, mapColors } from './mapStyle';
import { StyleSheet } from 'react-native';

export default function NativeGoogleMap(props: MapProps) {
  const ref = useRef<MapView>(null);
  const latest = useRef(props); latest.current = props;
  const fit = useCallback(() => {
    const data = latest.current;
    const coords = data.segments?.flatMap(s => s.coordinates) || [];
    if (data.fitToRoute && coords.length > 1) ref.current?.fitToCoordinates(coords, { edgePadding: { top: 44, bottom: 44, left: 44, right: 44 }, animated: false });
    else if (data.initialRegion) ref.current?.animateToRegion(data.initialRegion, 250);
  }, []);
  useEffect(fit, [fit, props.initialRegion?.latitude, props.initialRegion?.longitude, props.initialRegion?.latitudeDelta, props.initialRegion?.longitudeDelta, props.fitToRoute, props.fitRevision]);
  return <MapView ref={ref} testID={`${props.testID}-google-native`} style={styles.map} provider={PROVIDER_GOOGLE}
    initialRegion={props.initialRegion} onMapReady={fit} customMapStyle={googleMapStyle} showsPointsOfInterests showsBuildings
    showsUserLocation={props.showsUserLocation} toolbarEnabled={false} onPress={e => props.onPress?.(e.nativeEvent.coordinate)}>
    {props.segments?.map((s, i) => <React.Fragment key={i}>
      <Polyline testID={`${props.testID}-segment-${i}`} coordinates={s.coordinates}
        strokeColor={s.pending ? mapColors.caution : mapColors[s.freedom]} strokeWidth={props.selectedSegmentIndex === i ? 8 : 5} lineDashPattern={s.generated || s.pending ? [8, 8] : undefined} zIndex={8} />
      {!!props.onSegmentPress && <Polyline testID={`${props.testID}-select-segment-${i}`} coordinates={s.coordinates}
        strokeColor={`${mapColors.outline}00`} strokeWidth={44} tappable zIndex={9}
        onPress={e => props.onSegmentPress?.(i, e.nativeEvent.coordinate)} />}
    </React.Fragment>)}
    {props.markers?.map(m => <Marker key={m.id} testID={`${props.testID}-marker-${m.id}`} coordinate={m.coordinate}
      title={m.label} pinColor={m.color} onPress={m.onPress} zIndex={20} />)}
  </MapView>;
}
const styles = StyleSheet.create({ map: { flex: 1 } });
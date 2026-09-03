import React from "react";
import { View, StyleSheet, Platform, ScrollView, Text } from "react-native";
import { colors, radius, spacing } from "./theme";

// Types matching backend
export type LatLng = { latitude: number; longitude: number };
export type SegmentInput = { coordinates: LatLng[]; freedom: "free" | "caution" | "leash" };
export type MarkerInput = { id: string; coordinate: LatLng; color?: string; label?: string; onPress?: () => void };

const freedomColor: Record<string, string> = {
  free: colors.success,
  caution: colors.warning,
  leash: colors.error,
};

type Props = {
  initialRegion?: { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };
  segments?: SegmentInput[];
  markers?: MarkerInput[];
  onPress?: (c: LatLng) => void;
  onRegionChange?: (r: any) => void;
  showsUserLocation?: boolean;
  style?: any;
  testID?: string;
};

// Native map component using react-native-maps
const NativeMapImpl: React.FC<Props> = (props) => {
  const Maps = require("react-native-maps");
  const MapView = Maps.default;
  const { Marker, Polyline, PROVIDER_GOOGLE } = Maps;
  return (
    <MapView
      style={[{ flex: 1 }, props.style]}
      initialRegion={props.initialRegion}
      onPress={(e: any) => props.onPress && props.onPress(e.nativeEvent.coordinate)}
      onRegionChangeComplete={props.onRegionChange}
      showsUserLocation={props.showsUserLocation}
      provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
      testID={props.testID}
    >
      {props.segments?.map((seg, i) => (
        <Polyline
          key={`seg-${i}`}
          coordinates={seg.coordinates}
          strokeColor={freedomColor[seg.freedom]}
          strokeWidth={5}
        />
      ))}
      {props.markers?.map((m) => (
        <Marker
          key={m.id}
          coordinate={m.coordinate}
          pinColor={m.color || colors.brandPrimary}
          onPress={m.onPress}
          title={m.label}
        />
      ))}
    </MapView>
  );
};

// Web fallback: cartesian projection inside a container
const WebMapImpl: React.FC<Props> = (props) => {
  const region = props.initialRegion || { latitude: 48.85, longitude: 2.35, latitudeDelta: 0.1, longitudeDelta: 0.1 };
  const [size, setSize] = React.useState({ w: 320, h: 320 });

  const bounds = {
    minLat: region.latitude - region.latitudeDelta / 2,
    maxLat: region.latitude + region.latitudeDelta / 2,
    minLng: region.longitude - region.longitudeDelta / 2,
    maxLng: region.longitude + region.longitudeDelta / 2,
  };
  const project = (lat: number, lng: number) => {
    const x = ((lng - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * size.w;
    const y = size.h - ((lat - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * size.h;
    return { x, y };
  };

  const Svg = require("react-native-svg").default;
  const { Polyline: SPolyline, Circle } = require("react-native-svg");

  return (
    <View
      style={[{ flex: 1, backgroundColor: colors.brandTertiary, overflow: "hidden" }, props.style]}
      onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      testID={props.testID}
    >
      {/* Grid backdrop */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {[...Array(8)].map((_, i) => (
          <View key={`h${i}`} style={{ position: "absolute", left: 0, right: 0, top: (i / 8) * size.h, height: 1, backgroundColor: colors.border }} />
        ))}
        {[...Array(8)].map((_, i) => (
          <View key={`v${i}`} style={{ position: "absolute", top: 0, bottom: 0, left: (i / 8) * size.w, width: 1, backgroundColor: colors.border }} />
        ))}
      </View>
      <Svg width={size.w} height={size.h}>
        {props.segments?.map((seg, i) => {
          const pts = seg.coordinates.map((c) => project(c.latitude, c.longitude));
          const d = pts.map((p) => `${p.x},${p.y}`).join(" ");
          return <SPolyline key={`s${i}`} points={d} stroke={freedomColor[seg.freedom]} strokeWidth={4} fill="none" />;
        })}
        {props.markers?.map((m) => {
          const p = project(m.coordinate.latitude, m.coordinate.longitude);
          return <Circle key={m.id} cx={p.x} cy={p.y} r={7} fill={m.color || colors.brandPrimary} stroke="#fff" strokeWidth={2} />;
        })}
      </Svg>
      <View style={styles.webBadge} pointerEvents="none">
        <Text style={styles.webBadgeText}>Map preview · full interaction on mobile</Text>
      </View>
    </View>
  );
};

export const DoggoMap: React.FC<Props> = (props) => {
  if (Platform.OS === "web") return <WebMapImpl {...props} />;
  return <NativeMapImpl {...props} />;
};

const styles = StyleSheet.create({
  webBadge: {
    position: "absolute",
    bottom: spacing.sm,
    left: spacing.sm,
    backgroundColor: "rgba(26,28,25,0.72)",
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  webBadgeText: { color: "#fff", fontSize: 11, fontWeight: "600" },
});

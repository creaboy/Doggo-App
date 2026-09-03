import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { Warning, X } from "phosphor-react-native";
import { useAuth } from "./AuthContext";
import { api } from "./api";
import { colors, radius, spacing } from "./theme";
import { hazardTypeLabels } from "./labels";

type Hazard = { id: string; walk_id: string; walk_title: string; type: string; lat: number; lng: number; description?: string };

const ALERT_RADIUS_M = 300; // trigger within 300m

function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

export function NearbyAlertsBanner() {
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [hazards, setHazards] = useState<Hazard[]>([]);
  const [current, setCurrent] = useState<Hazard | null>(null);
  const dismissedRef = useRef<Set<string>>(new Set());
  const subRef = useRef<any>(null);

  // Load hazards on user login and every 60s
  useEffect(() => {
    if (!user) {
      setHazards([]);
      setCurrent(null);
      dismissedRef.current = new Set();
      return;
    }
    let mounted = true;
    const load = async () => {
      try {
        const list = await api("/me/favorites/hazards");
        if (mounted) setHazards(list);
      } catch {}
    };
    load();
    const iv = setInterval(load, 60000);
    return () => { mounted = false; clearInterval(iv); };
  }, [user]);

  // Watch position when we have hazards
  useEffect(() => {
    if (!user || hazards.length === 0) {
      if (subRef.current) { subRef.current.remove(); subRef.current = null; }
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        if (Platform.OS === "web") {
          if (!navigator.geolocation) return;
          const watchId = navigator.geolocation.watchPosition(
            (pos) => {
              if (cancelled) return;
              checkHazards({ lat: pos.coords.latitude, lng: pos.coords.longitude });
            },
            () => {},
            { enableHighAccuracy: false, maximumAge: 30000, timeout: 15000 }
          );
          subRef.current = { remove: () => navigator.geolocation.clearWatch(watchId) };
        } else {
          const { status } = await Location.getForegroundPermissionsAsync();
          if (status !== "granted") return; // wait until user grants elsewhere
          const sub = await Location.watchPositionAsync(
            { accuracy: Location.Accuracy.Balanced, distanceInterval: 30, timeInterval: 15000 },
            (loc) => {
              if (cancelled) return;
              checkHazards({ lat: loc.coords.latitude, lng: loc.coords.longitude });
            },
          );
          subRef.current = sub;
        }
      } catch {}
    })();
    return () => {
      cancelled = true;
      if (subRef.current) { subRef.current.remove(); subRef.current = null; }
    };
  }, [user, hazards]);

  const checkHazards = (userPos: { lat: number; lng: number }) => {
    for (const h of hazards) {
      if (dismissedRef.current.has(h.id)) continue;
      if (distanceMeters(userPos, { lat: h.lat, lng: h.lng }) <= ALERT_RADIUS_M) {
        setCurrent(h);
        return;
      }
    }
  };

  if (!current) return null;

  const dismiss = () => {
    if (current) dismissedRef.current.add(current.id);
    setCurrent(null);
  };

  return (
    <View style={[styles.wrap, { top: insets.top + spacing.sm }]} pointerEvents="box-none">
      <Pressable
        testID="nearby-alert-banner"
        style={styles.banner}
        onPress={() => { const c = current; dismiss(); if (c) router.push(`/walk/${c.walk_id}`); }}
      >
        <View style={styles.iconBox}><Warning size={20} color="#fff" weight="fill" /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Hazard nearby: {hazardTypeLabels[current.type] || current.type}</Text>
          <Text style={styles.sub} numberOfLines={1}>{current.walk_title} · tap to view</Text>
        </View>
        <Pressable testID="dismiss-alert" hitSlop={10} onPress={dismiss} style={styles.close}><X size={16} color="#fff" /></Pressable>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: spacing.md, right: spacing.md, zIndex: 1000 },
  banner: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.error, borderRadius: radius.md, padding: spacing.md,
    shadowColor: "#000", shadowOpacity: 0.15, shadowOffset: { width: 0, height: 4 }, shadowRadius: 12, elevation: 6,
  },
  iconBox: { width: 32, height: 32, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" },
  title: { color: "#fff", fontWeight: "700", fontSize: 14 },
  sub: { color: "rgba(255,255,255,0.85)", fontSize: 12, marginTop: 2 },
  close: { width: 28, height: 28, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },
});

import { useEffect, useState } from "react";
import { Platform } from "react-native";
import * as Location from "expo-location";

export type UserLoc = { lat: number; lng: number };

export function useUserLocation(enabled: boolean) {
  const [loc, setLoc] = useState<UserLoc | null>(null);
  const [status, setStatus] = useState<"idle" | "requesting" | "granted" | "denied">("idle");

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      setStatus("requesting");
      try {
        if (Platform.OS === "web") {
          if (typeof navigator === "undefined" || !navigator.geolocation) {
            setStatus("denied");
            return;
          }
          navigator.geolocation.getCurrentPosition(
            (p) => { if (!cancelled) { setLoc({ lat: p.coords.latitude, lng: p.coords.longitude }); setStatus("granted"); } },
            () => { if (!cancelled) setStatus("denied"); },
            { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 }
          );
          return;
        }
        const perm = await Location.getForegroundPermissionsAsync();
        let allow = perm.status === "granted";
        if (!allow && perm.canAskAgain) {
          const req = await Location.requestForegroundPermissionsAsync();
          allow = req.status === "granted";
        }
        if (!allow) { if (!cancelled) setStatus("denied"); return; }
        const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (!cancelled) { setLoc({ lat: p.coords.latitude, lng: p.coords.longitude }); setStatus("granted"); }
      } catch {
        if (!cancelled) setStatus("denied");
      }
    })();
    return () => { cancelled = true; };
  }, [enabled]);

  return { loc, status };
}

export function distanceKm(a: UserLoc, b: { lat: number; lng: number }) {
  const R = 6371;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

import { useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import type { LatLng } from './DoggoMap';
import { GpsSample, meters } from './routeDraft';

export function usableFix(loc: Location.LocationObject, previous: Location.LocationObject | null, now = Date.now()) {
  const { latitude, longitude, accuracy } = loc.coords;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return false;
  if (accuracy == null || accuracy < 0 || accuracy > 25 || now - loc.timestamp > 15000) return false;
  if (!previous) return true;
  const elapsed = (loc.timestamp - previous.timestamp) / 1000;
  const gap = meters(previous.coords, loc.coords);
  return elapsed > 0 && gap >= 3 && gap / elapsed <= 8;
}

export function useRouteRecorder(onPoint: (point: GpsSample) => void, onError: (error: string) => void) {
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [signal, setSignal] = useState('');
  const [position, setPosition] = useState<LatLng | null>(null);
  const sub = useRef<Location.LocationSubscription | null>(null);
  const active = useRef(false);
  const generation = useRef(0);
  const lastFix = useRef<Location.LocationObject | null>(null);
  const callbacks = useRef({ onPoint, onError }); callbacks.current = { onPoint, onError };

  const stop = () => {
    generation.current++; active.current = false; sub.current?.remove(); sub.current = null;
    setRecording(false); setStarting(false);
  };
  const start = async () => {
    if (active.current) return;
    const token = ++generation.current;
    active.current = true; setStarting(true); setSignal('Recherche d’un signal GPS précis…');
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (token !== generation.current) return;
      if (permission.status !== 'granted') throw new Error('Autorisez la localisation pour enregistrer votre balade.');
      const accept = (loc: Location.LocationObject) => {
        if (!active.current || token !== generation.current) return;
        if (!usableFix(loc, lastFix.current)) {
          if (loc.coords.accuracy == null || loc.coords.accuracy > 25) setSignal('GPS imprécis : attente d’un meilleur signal.');
          return;
        }
        lastFix.current = loc;
        const point = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
        setPosition(point); setSignal('GPS actif · l’arrêt reste toujours manuel');
        callbacks.current.onPoint({ ...point, timestamp: loc.timestamp, accuracy: Math.max(1, loc.coords.accuracy || 20) });
      };
      // The watcher delivers its first usable fix as the official start. No background auto-stop.
      const watcher = await Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 3, timeInterval: 2000 }, accept);
      if (!active.current || token !== generation.current) { watcher.remove(); return; }
      sub.current = watcher; setRecording(true);
    } catch (e: any) {
      if (token === generation.current) { active.current = false; callbacks.current.onError(e.message || 'Le GPS est indisponible. Votre tracé est conservé.'); }
    } finally { if (token === generation.current) setStarting(false); }
  };
  const reset = () => { stop(); lastFix.current = null; setPosition(null); setSignal(''); };
  useEffect(() => () => { generation.current++; active.current = false; sub.current?.remove(); }, []);
  return { recording, starting, signal, position, start, stop, reset };
}
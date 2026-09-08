import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import type { LatLng } from './DoggoMap';

type Snapshot = { coordinate: LatLng | null; accuracy: number | null; timestamp: number; status: 'loading' | 'live' | 'denied' | 'unavailable' | 'stale' };
const initial: Snapshot = { coordinate: null, accuracy: null, timestamp: 0, status: 'loading' };
let snapshot = initial;
const listeners = new Set<() => void>();
let watcher: Location.LocationSubscription | null = null;
let appSubscription: ReturnType<typeof AppState.addEventListener> | null = null;
let ageTimer: ReturnType<typeof setInterval> | null = null;
let generation = 0;
let starting = false;

function update(change: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...change };
  listeners.forEach(listener => listener());
}
function stop() {
  generation++; starting = false; watcher?.remove(); watcher = null;
}
async function start(ask = false) {
  if (!listeners.size || watcher || starting || (AppState.currentState && AppState.currentState !== 'active')) return;
  const token = ++generation;
  starting = true;
  update({ status: snapshot.coordinate ? 'stale' : 'loading' });
  const fail = () => {
    if (token === generation) update({ status: snapshot.coordinate ? 'stale' : 'unavailable' });
  };
  const accept = (fix: Location.LocationObject) => {
    if (token !== generation || !listeners.size) return;
    const { latitude, longitude, accuracy } = fix.coords;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || !Number.isFinite(fix.timestamp)) return;
    if (Date.now() - fix.timestamp > 30000 || fix.timestamp < snapshot.timestamp) return;
    update({ coordinate: { latitude, longitude }, accuracy: Number.isFinite(accuracy) && accuracy! >= 0 ? accuracy : null, timestamp: fix.timestamp, status: 'live' });
  };
  try {
    let permission = await Location.getForegroundPermissionsAsync();
    if (token !== generation) return;
    if (permission.status !== 'granted' && permission.canAskAgain && (ask || permission.status === 'undetermined')) {
      permission = await Location.requestForegroundPermissionsAsync();
    }
    if (token !== generation) return;
    if (permission.status !== 'granted') { update({ ...initial, status: 'denied' }); return; }
    const subscription = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 2000, distanceInterval: 1 }, accept, fail);
    if (token !== generation || !listeners.size) { subscription.remove(); return; }
    watcher = subscription;
    // Seed the marker immediately. The watch remains independent from route recording.
    void Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }).then(accept).catch(() => {});
  } catch { fail(); }
  finally { if (token === generation) starting = false; }
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    appSubscription = AppState.addEventListener('change', state => {
      if (state === 'active') void start();
      else { stop(); if (snapshot.coordinate) update({ status: 'stale' }); }
    });
    ageTimer = setInterval(() => {
      if (snapshot.status === 'live' && Date.now() - snapshot.timestamp > 45000) update({ status: 'stale' });
    }, 5000);
    void start();
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      stop(); appSubscription?.remove(); appSubscription = null;
      if (ageTimer) clearInterval(ageTimer);
      ageTimer = null; snapshot = initial;
    }
  };
}
const getSnapshot = () => snapshot;
const getServerSnapshot = () => initial;
const retry = () => { stop(); void start(true); };

// All mounted maps share one foreground watcher; no recording or routing is started here.
export function useLiveMapLocation() {
  return { ...useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot), retry };
}
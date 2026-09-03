import React, { useEffect, useRef, useMemo } from "react";
import { View, StyleSheet, Platform } from "react-native";
import { colors } from "./theme";

// Types
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
  showsUserLocation?: boolean;
  style?: any;
  testID?: string;
};

function calcZoom(latDelta: number, lngDelta: number): number {
  const worldLat = 360;
  const zoom = Math.log2(worldLat / Math.max(latDelta, lngDelta / 2));
  return Math.max(2, Math.min(18, Math.round(zoom)));
}

// ============ Shared HTML template ============

function buildHtml(
  region: { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number },
  showsUserLocation: boolean
): string {
  const zoom = calcZoom(region.latitudeDelta, region.longitudeDelta);
  return `<!doctype html><html><head>
<meta name="viewport" content="initial-scale=1.0,maximum-scale=1.0,user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>html,body,#m{margin:0;padding:0;height:100%;width:100%;background:#F1F4EE;}
.pin{width:22px;height:22px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.4);box-sizing:border-box;}
.leaflet-container{background:#F1F4EE;}
</style></head><body>
<div id="m"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
(function(){
  var map = L.map('m', {zoomControl: true, attributionControl: true}).setView([${region.latitude}, ${region.longitude}], ${zoom});
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:19, attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);
  var layers = [];
  var userMarker = null;

  function post(obj){
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify(obj));
      }
    } catch(e){}
  }

  map.on('click', function(e){ post({type:'press', lat:e.latlng.lat, lng:e.latlng.lng}); });

  window.__renderData = function(data){
    layers.forEach(function(l){ map.removeLayer(l); });
    layers = [];
    (data.segments || []).forEach(function(seg){
      if (!seg.coordinates || seg.coordinates.length < 2) return;
      var pts = seg.coordinates.map(function(c){ return [c.latitude, c.longitude]; });
      var color = seg.freedom === 'free' ? '${colors.success}' : seg.freedom === 'caution' ? '${colors.warning}' : '${colors.error}';
      var pl = L.polyline(pts, {color: color, weight: 5}).addTo(map);
      layers.push(pl);
    });
    (data.markers || []).forEach(function(m){
      var html = '<div class="pin" style="background:' + (m.color || '${colors.brandPrimary}') + '"></div>';
      var icon = L.divIcon({html: html, iconSize:[22,22], iconAnchor:[11,11], className:''});
      var mk = L.marker([m.coordinate.latitude, m.coordinate.longitude], {icon: icon, title: m.label || ''}).addTo(map);
      mk.on('click', function(){ post({type:'markerPress', id: m.id}); });
      if (m.label) mk.bindTooltip(m.label);
      layers.push(mk);
    });
  };

  window.__setRegion = function(r){
    try { map.setView([r.latitude, r.longitude], ${zoom}); } catch(e){}
  };

  ${showsUserLocation ? `
    if (navigator.geolocation) {
      navigator.geolocation.watchPosition(function(pos){
        var ll = [pos.coords.latitude, pos.coords.longitude];
        if (userMarker) { userMarker.setLatLng(ll); } else {
          var icon = L.divIcon({html:'<div style="width:16px;height:16px;border-radius:50%;background:#4285F4;border:3px solid #fff;box-shadow:0 0 0 2px rgba(66,133,244,0.3)"></div>', iconSize:[16,16], iconAnchor:[8,8], className:''});
          userMarker = L.marker(ll, {icon: icon}).addTo(map);
        }
      }, function(){}, {enableHighAccuracy:false, maximumAge:30000, timeout:15000});
    }
  ` : ''}

  post({type:'ready'});
})();
</script>
</body></html>`;
}

// ============ Native (iOS + Android): WebView + Leaflet ============

const NativeMapImpl: React.FC<Props> = (props) => {
  const WebView = require("react-native-webview").WebView;
  const ref = useRef<any>(null);
  const readyRef = useRef(false);

  const region = props.initialRegion || { latitude: 48.85, longitude: 2.35, latitudeDelta: 0.1, longitudeDelta: 0.1 };
  const html = useMemo(() => buildHtml(region, !!props.showsUserLocation), [region.latitude, region.longitude, region.latitudeDelta, region.longitudeDelta, props.showsUserLocation]);

  const pushData = () => {
    if (!ref.current || !readyRef.current) return;
    const data = JSON.stringify({ segments: props.segments || [], markers: props.markers || [] });
    ref.current.injectJavaScript(`window.__renderData(${data}); true;`);
  };

  useEffect(() => { pushData(); }, [props.segments, props.markers]);

  const onMessage = (e: any) => {
    let msg: any = null;
    try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (msg.type === "ready") {
      readyRef.current = true;
      pushData();
    } else if (msg.type === "press" && props.onPress) {
      props.onPress({ latitude: msg.lat, longitude: msg.lng });
    } else if (msg.type === "markerPress" && props.markers) {
      const m = props.markers.find((x) => x.id === msg.id);
      if (m?.onPress) m.onPress();
    }
  };

  return (
    <View style={[{ flex: 1, backgroundColor: colors.brandTertiary, overflow: "hidden" }, props.style]} testID={props.testID}>
      <WebView
        ref={ref}
        originWhitelist={["*"]}
        source={{ html }}
        onMessage={onMessage}
        javaScriptEnabled
        domStorageEnabled
        setSupportMultipleWindows={false}
        mixedContentMode="always"
        style={{ flex: 1, backgroundColor: colors.brandTertiary }}
        androidLayerType="hardware"
      />
    </View>
  );
};

// ============ Web: Leaflet directly ============

let leafletLoading: Promise<any> | null = null;
function loadLeaflet(): Promise<any> {
  // @ts-ignore
  if (typeof window === "undefined") return Promise.reject("no window");
  // @ts-ignore
  if (window.L) return Promise.resolve(window.L);
  if (leafletLoading) return leafletLoading;
  leafletLoading = new Promise((resolve, reject) => {
    const doc = document;
    if (!doc.getElementById("leaflet-css")) {
      const link = doc.createElement("link");
      link.id = "leaflet-css";
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      doc.head.appendChild(link);
    }
    if (doc.getElementById("leaflet-js")) {
      // @ts-ignore
      if (window.L) resolve(window.L);
      else doc.getElementById("leaflet-js")!.addEventListener("load", () => resolve((window as any).L));
      return;
    }
    const s = doc.createElement("script");
    s.id = "leaflet-js";
    s.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    s.async = true;
    s.onload = () => resolve((window as any).L);
    s.onerror = (e) => reject(e);
    doc.body.appendChild(s);
  });
  return leafletLoading;
}

const WebMapImpl: React.FC<Props> = (props) => {
  const containerRef = useRef<any>(null);
  const mapRef = useRef<any>(null);
  const layersRef = useRef<any[]>([]);
  const readyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    loadLeaflet().then((L) => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      const region = props.initialRegion || { latitude: 48.85, longitude: 2.35, latitudeDelta: 0.1, longitudeDelta: 0.1 };
      const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true })
        .setView([region.latitude, region.longitude], calcZoom(region.latitudeDelta, region.longitudeDelta));
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);
      map.on("click", (e: any) => { if (props.onPress) props.onPress({ latitude: e.latlng.lat, longitude: e.latlng.lng }); });
      mapRef.current = map;
      readyRef.current = true;
      renderLayers();
      setTimeout(() => { try { map.invalidateSize(); } catch {} }, 100);
    }).catch(() => {});
    return () => {
      cancelled = true;
      if (mapRef.current) { try { mapRef.current.remove(); } catch {} mapRef.current = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!mapRef.current || !props.initialRegion) return;
    const r = props.initialRegion;
    try { mapRef.current.setView([r.latitude, r.longitude], calcZoom(r.latitudeDelta, r.longitudeDelta)); } catch {}
  }, [props.initialRegion?.latitude, props.initialRegion?.longitude, props.initialRegion?.latitudeDelta, props.initialRegion?.longitudeDelta]);

  const renderLayers = () => {
    const L = (window as any).L;
    if (!L || !mapRef.current) return;
    layersRef.current.forEach((l) => { try { mapRef.current.removeLayer(l); } catch {} });
    layersRef.current = [];
    props.segments?.forEach((seg) => {
      if (!seg.coordinates || seg.coordinates.length < 2) return;
      const pts = seg.coordinates.map((c) => [c.latitude, c.longitude]);
      const pl = L.polyline(pts, { color: freedomColor[seg.freedom], weight: 5 }).addTo(mapRef.current);
      layersRef.current.push(pl);
    });
    props.markers?.forEach((m) => {
      const color = m.color || colors.brandPrimary;
      const html = `<div style="width:22px;height:22px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.4);box-sizing:border-box"></div>`;
      const icon = L.divIcon({ html, iconSize: [22, 22], iconAnchor: [11, 11], className: "" });
      const mk = L.marker([m.coordinate.latitude, m.coordinate.longitude], { icon, title: m.label || "" }).addTo(mapRef.current);
      if (m.onPress) mk.on("click", m.onPress);
      if (m.label) mk.bindTooltip(m.label);
      layersRef.current.push(mk);
    });
  };

  useEffect(() => { if (readyRef.current) renderLayers(); }, [props.segments, props.markers]);

  return (
    <View style={[{ flex: 1, backgroundColor: colors.brandTertiary, overflow: "hidden" }, props.style]} testID={props.testID}>
      {/* @ts-ignore */}
      <div ref={(el: any) => { containerRef.current = el; }} style={{ width: "100%", height: "100%" }} />
    </View>
  );
};

export const DoggoMap: React.FC<Props> = (props) => {
  if (Platform.OS === "web") return <WebMapImpl {...props} />;
  return <NativeMapImpl {...props} />;
};

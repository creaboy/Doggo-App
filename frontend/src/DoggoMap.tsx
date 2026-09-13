import React, { useCallback, useEffect, useRef, useMemo, useState } from "react";
import { View, Platform, StyleSheet, Linking } from "react-native";
import { colors } from "./theme";
import { GoogleDoggoMap } from "./GoogleDoggoMap";
import { useLiveMapLocation } from "./useLiveMapLocation";
import { MapLocationControl } from "./MapLocationControl";
import { resolveTileSource, TILE_USER_AGENT, TileSource } from "./tileSource";

/**
 * Variables `EXPO_PUBLIC_*` lues ici (et non passées comme objet) pour que Metro les
 * inline au build. Le fond de carte OpenStreetMap ne demande aucune clé par défaut.
 */
function tileEnv() {
  return {
    url: process.env.EXPO_PUBLIC_TILE_URL,
    attribution: process.env.EXPO_PUBLIC_TILE_ATTRIBUTION,
    subdomains: process.env.EXPO_PUBLIC_TILE_SUBDOMAINS,
    credit: process.env.EXPO_PUBLIC_TILE_CREDIT,
    cartoKey: process.env.EXPO_PUBLIC_CARTO_API_KEY,
  };
}

// Types
export type LatLng = { latitude: number; longitude: number };
export type SegmentInput = { coordinates: LatLng[]; freedom: "free" | "caution" | "leash"; generated?: boolean; pending?: boolean };
export type MarkerInput = { id: string; coordinate: LatLng; color?: string; label?: string; onPress?: () => void };

const freedomColor: Record<string, string> = {
  free: colors.success,
  caution: colors.warning,
  leash: colors.error,
};

export type MapProps = {
  initialRegion?: { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };
  segments?: SegmentInput[];
  markers?: MarkerInput[];
  onPress?: (c: LatLng) => void;
  showsUserLocation?: boolean;
  style?: any;
  testID?: string;
  fitToRoute?: boolean;
  fitRevision?: number;
  userCoordinate?: LatLng | null;
  userAccuracy?: number | null;
  locationStale?: boolean;
  locationFocus?: { id: number; coordinate: LatLng };
  onSegmentPress?: (index: number, coordinate?: LatLng) => void;
  selectedSegmentIndex?: number;
};
type Props = MapProps;

function calcZoom(latDelta: number, lngDelta: number): number {
  const worldLat = 360;
  const zoom = Math.log2(worldLat / Math.max(latDelta, lngDelta / 2));
  return Math.max(2, Math.min(18, Math.round(zoom)));
}

// ============ Shared HTML template ============

function buildHtml(
  region: { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number },
  tiles: TileSource
): string {
  const zoom = calcZoom(region.latitudeDelta, region.longitudeDelta);
  return `<!doctype html><html><head>
<meta name="viewport" content="initial-scale=1.0,maximum-scale=1.0,user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>html,body,#m{margin:0;padding:0;height:100%;width:100%;background:#F1F4EE;}
.pin{width:22px;height:22px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.4);box-sizing:border-box;}
.leaflet-container{background:#F1F4EE;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;}
.leaflet-control-attribution{background:rgba(255,255,255,0.72);font-size:10px;line-height:14px;padding:1px 5px;}
.leaflet-control-zoom a{color:#333;}
</style></head><body>
<div id="m"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
(function(){
  var TILES = ${JSON.stringify(tiles)};
  var map = L.map('m', {zoomControl: true, attributionControl: true, zoomSnap: 0.5, zoomDelta: 0.5}).setView([${region.latitude}, ${region.longitude}], ${zoom});
  if (map.attributionControl) map.attributionControl.setPrefix(false);
  L.tileLayer(TILES.url, {maxZoom: TILES.maxZoom, subdomains: TILES.subdomains, attribution: TILES.attribution, keepBuffer: 2}).addTo(map);
  var layers = [];
  var userMarker = null;
  var accuracyCircle = null;
  var focusId;
  map.createPane('doggo-user-location').style.zIndex = '650';

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
    (data.segments || []).forEach(function(seg,index){
      if (!seg.coordinates || seg.coordinates.length < 2) return;
      var pts = seg.coordinates.map(function(c){ return [c.latitude, c.longitude]; });
      var color = seg.freedom === 'free' ? '${colors.success}' : seg.freedom === 'caution' ? '${colors.warning}' : '${colors.error}';
      var pl = L.polyline(pts, {color: seg.pending ? '${colors.warning}' : color, weight: data.selectedSegmentIndex===index ? 8 : 5, dashArray:seg.generated || seg.pending ? '8 8' : null}).addTo(map);
      layers.push(pl);
      if(data.segmentEditable){ var hit=L.polyline(pts,{weight:44,opacity:0}).addTo(map); hit.on('click',function(e){L.DomEvent.stopPropagation(e);post({type:'segmentPress',index:index,lat:e.latlng.lat,lng:e.latlng.lng});});layers.push(hit); }
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

  window.__setUserLocation = function(data){
    if(data.userCoordinate){
      var p=[data.userCoordinate.latitude,data.userCoordinate.longitude];
      var color=data.locationStale ? '${colors.muted}' : '${colors.location}';
      if(!userMarker) userMarker=L.circleMarker(p,{pane:'doggo-user-location',radius:8,color:'${colors.surfaceSecondary}',weight:3,fillOpacity:1,interactive:false}).addTo(map);
      userMarker.setLatLng(p).setStyle({fillColor:color});
      if(!accuracyCircle) accuracyCircle=L.circle(p,{weight:1,opacity:.2,fillOpacity:.09,interactive:false}).addTo(map);
      accuracyCircle.setLatLng(p).setRadius(data.userAccuracy || 0).setStyle({color:color,fillColor:color}).bringToBack();
    }else{
      if(userMarker){map.removeLayer(userMarker);userMarker=null;}
      if(accuracyCircle){map.removeLayer(accuracyCircle);accuracyCircle=null;}
    }
    if(data.locationFocus && data.locationFocus.id!==focusId){focusId=data.locationFocus.id;var c=data.locationFocus.coordinate;map.setView([c.latitude,c.longitude],17);}
  };

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
  const tiles = useMemo(() => resolveTileSource(tileEnv()), []);
  const html = useMemo(() => buildHtml(region, tiles), [region.latitude, region.longitude, region.latitudeDelta, region.longitudeDelta, tiles]);

  const pushData = () => {
    if (!ref.current || !readyRef.current) return;
    const data = JSON.stringify({ segments: props.segments || [], markers: props.markers || [], segmentEditable: !!props.onSegmentPress, selectedSegmentIndex: props.selectedSegmentIndex });
    ref.current.injectJavaScript(`window.__renderData(${data}); true;`);
  };

  useEffect(() => { pushData(); }, [props.segments, props.markers, props.onSegmentPress, props.selectedSegmentIndex]);
  const pushLocation = useCallback(() => {
    if (!readyRef.current) return;
    const data = JSON.stringify({ userCoordinate: props.userCoordinate, userAccuracy: props.userAccuracy, locationStale: props.locationStale, locationFocus: props.locationFocus });
    ref.current?.injectJavaScript(`window.__setUserLocation(${data});true;`);
  }, [props.userCoordinate, props.userAccuracy, props.locationStale, props.locationFocus]);
  useEffect(pushLocation, [pushLocation]);

  const onMessage = (e: any) => {
    let msg: any = null;
    try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (msg.type === "ready") {
      readyRef.current = true;
      pushData();
      pushLocation();
    } else if (msg.type === "press" && props.onPress) {
      props.onPress({ latitude: msg.lat, longitude: msg.lng });
    } else if (msg.type === "segmentPress") {
      props.onSegmentPress?.(msg.index, { latitude: msg.lat, longitude: msg.lng });
    } else if (msg.type === "markerPress" && props.markers) {
      const m = props.markers.find((x) => x.id === msg.id);
      if (m?.onPress) m.onPress();
    }
  };

  return (
    <View
      style={[{ flex: 1, backgroundColor: colors.brandTertiary, overflow: "hidden" }, props.style]}
      testID={props.testID}
      // capture gestures so parent ScrollView doesn't hijack pinch/pan
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
    >
      <WebView
        ref={ref}
        originWhitelist={["*"]}
        userAgent={TILE_USER_AGENT}
        source={{ html }}
        onMessage={onMessage}
        javaScriptEnabled
        domStorageEnabled
        setSupportMultipleWindows={false}
        mixedContentMode="always"
        style={{ flex: 1, backgroundColor: colors.brandTertiary }}
        androidLayerType="hardware"
        nestedScrollEnabled
        scrollEnabled={false}
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
  const latestProps = useRef(props);
  latestProps.current = props;
  const positionRef = useRef<any>(null);
  const accuracyRef = useRef<any>(null);
  const focusRef = useRef<number | undefined>(undefined);
  const renderLocation = useCallback(() => {
    const L = (window as any).L, map = mapRef.current, data = latestProps.current;
    if (!L || !map) return;
    if (data.userCoordinate) {
      const p = [data.userCoordinate.latitude, data.userCoordinate.longitude];
      const color = data.locationStale ? colors.muted : colors.location;
      if (!positionRef.current) positionRef.current = L.circleMarker(p, { pane: 'doggo-user-location', radius: 8, color: colors.surfaceSecondary, weight: 3, fillOpacity: 1, interactive: false }).addTo(map);
      positionRef.current.setLatLng(p).setStyle({ fillColor: color });
      positionRef.current.getElement()?.setAttribute('data-testid', `${data.testID}-user-position`);
      if (!accuracyRef.current) accuracyRef.current = L.circle(p, { weight: 1, opacity: .2, fillOpacity: .09, interactive: false }).addTo(map);
      accuracyRef.current.setLatLng(p).setRadius(data.userAccuracy || 0).setStyle({ color, fillColor: color }).bringToBack();
    } else {
      if (positionRef.current) { map.removeLayer(positionRef.current); positionRef.current = null; }
      if (accuracyRef.current) { map.removeLayer(accuracyRef.current); accuracyRef.current = null; }
    }
    if (data.locationFocus && data.locationFocus.id !== focusRef.current) {
      focusRef.current = data.locationFocus.id;
      const p = data.locationFocus.coordinate; map.setView([p.latitude, p.longitude], 17);
    }
  }, []);
  useEffect(renderLocation, [renderLocation, props.userCoordinate, props.userAccuracy, props.locationStale, props.locationFocus]);

  useEffect(() => {
    let cancelled = false;
    loadLeaflet().then((L) => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      const region = props.initialRegion || { latitude: 48.85, longitude: 2.35, latitudeDelta: 0.1, longitudeDelta: 0.1 };
      const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true, zoomSnap: 0.5, zoomDelta: 0.5 })
        .setView([region.latitude, region.longitude], calcZoom(region.latitudeDelta, region.longitudeDelta));
      const tiles = resolveTileSource(tileEnv());
      if (map.attributionControl) map.attributionControl.setPrefix(false);
      L.tileLayer(tiles.url, {
        maxZoom: tiles.maxZoom,
        subdomains: tiles.subdomains,
        attribution: tiles.attribution,
      }).addTo(map);
      map.on("click", (e: any) => { latestProps.current.onPress?.({ latitude: e.latlng.lat, longitude: e.latlng.lng }); });
      mapRef.current = map;
      map.createPane('doggo-user-location').style.zIndex = '650';
      readyRef.current = true;
      renderLayers();
      renderLocation();
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
    props.segments?.forEach((seg, index) => {
      if (!seg.coordinates || seg.coordinates.length < 2) return;
      const pts = seg.coordinates.map((c) => [c.latitude, c.longitude]);
      const pl = L.polyline(pts, { color: seg.pending ? colors.warning : freedomColor[seg.freedom], weight: props.selectedSegmentIndex === index ? 8 : 5, dashArray: seg.generated || seg.pending ? '8 8' : undefined }).addTo(mapRef.current);
      layersRef.current.push(pl);
      if (props.onSegmentPress) {
        const hit = L.polyline(pts, { weight: 44, opacity: 0 }).addTo(mapRef.current);
        hit.on('click', (e: any) => { L.DomEvent.stopPropagation(e); latestProps.current.onSegmentPress?.(index, { latitude: e.latlng.lat, longitude: e.latlng.lng }); });
        layersRef.current.push(hit);
      }
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

  useEffect(() => { if (readyRef.current) renderLayers(); }, [props.segments, props.markers, props.selectedSegmentIndex, props.onSegmentPress]);

  return (
    <View
      style={[{ flex: 1, backgroundColor: colors.brandTertiary, overflow: "hidden" }, props.style]}
      testID={props.testID}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
    >
      {/* @ts-ignore */}
      <div ref={(el: any) => { containerRef.current = el; }} style={{ width: "100%", height: "100%", touchAction: "none" }} />
    </View>
  );
};

const LeafletMap: React.FC<Props> = (props) => {
  if (Platform.OS === "web") return <WebMapImpl {...props} />;
  return <NativeMapImpl {...props} />;
};

export const DoggoMap: React.FC<Props> = (props) => {
  const gps = useLiveMapLocation();
  const [focus, setFocus] = useState<MapProps['locationFocus']>();
  const pendingFocus = useRef(false);
  useEffect(() => {
    if (pendingFocus.current && gps.coordinate && gps.status === 'live') {
      pendingFocus.current = false;
      setFocus(previous => ({ id: (previous?.id || 0) + 1, coordinate: gps.coordinate! }));
    }
  }, [gps.coordinate, gps.status]);
  const locate = () => {
    if (gps.coordinate) setFocus(previous => ({ id: (previous?.id || 0) + 1, coordinate: gps.coordinate! }));
    if (gps.status !== 'live') {
      pendingFocus.current = true;
      if (gps.status === 'denied' && Platform.OS !== 'web') void Linking.openSettings().catch(() => {});
      else gps.retry();
    }
  };
  const mapProps = { ...props, style: mapStyles.fill, showsUserLocation: true, userCoordinate: gps.coordinate,
    userAccuracy: gps.accuracy, locationStale: gps.status !== 'live', locationFocus: focus };
  return <View style={[mapStyles.root, props.style]}>
    <GoogleDoggoMap {...mapProps} fallback={<LeafletMap {...mapProps} />} />
    <MapLocationControl prefix={props.testID || 'doggo-map'} status={gps.status} onPress={locate} />
  </View>;
};
const mapStyles = StyleSheet.create({ root: { flex: 1, overflow: 'hidden' }, fill: { flex: 1 } });

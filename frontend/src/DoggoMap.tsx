import React, { useCallback, useEffect, useRef, useMemo, useState } from "react";
import { View, Platform, StyleSheet, Linking } from "react-native";
import { colors } from "./theme";
import { GoogleDoggoMap } from "./GoogleDoggoMap";
import { useLiveMapLocation } from "./useLiveMapLocation";
import { MapLocationControl } from "./MapLocationControl";
import { resolveMapStyle, TILE_USER_AGENT, MapStyleSource } from "./tileSource";

/**
 * Variables `EXPO_PUBLIC_*` lues ici (et non passées comme objet) pour que Metro les
 * inline au build. Par défaut (OpenFreeMap Liberty) aucune clé n'est nécessaire.
 */
function styleEnv() {
  return {
    styleUrl: process.env.EXPO_PUBLIC_MAP_STYLE_URL,
    cartoKey: process.env.EXPO_PUBLIC_CARTO_API_KEY,
    style: process.env.EXPO_PUBLIC_MAP_STYLE,
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

/** Génère un polygone « cercle » géodésique approché (pour le disque de précision GPS). */
function circlePolygon(c: LatLng, radiusMeters: number): any {
  const pts: [number, number][] = [];
  const steps = 48;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const dLat = (radiusMeters * Math.cos(a)) / 111111;
    const dLng = (radiusMeters * Math.sin(a)) / (111111 * Math.cos((c.latitude * Math.PI) / 180));
    pts.push([c.longitude + dLng, c.latitude + dLat]);
  }
  if (pts.length) pts.push(pts[0]);
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [pts] } };
}
const EMPTY_FC = { type: "FeatureCollection", features: [] };

const MAP_COLORS = {
  free: colors.success, caution: colors.warning, leash: colors.error,
  outline: colors.surfaceSecondary, brand: colors.brandPrimary, location: colors.location, muted: colors.muted,
};

// ============ Shared HTML template (MapLibre GL + repli Leaflet) ============

function buildHtml(
  region: { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number },
  style: MapStyleSource
): string {
  const zoom = calcZoom(region.latitudeDelta, region.longitudeDelta);
  return `<!doctype html><html><head>
<meta name="viewport" content="initial-scale=1.0,maximum-scale=1.0,user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" />
<style>html,body,#m{margin:0;padding:0;height:100%;width:100%;background:#F1F4EE;}
.pin{width:22px;height:22px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.4);box-sizing:border-box;cursor:pointer;}
.userdot{width:20px;height:20px;border-radius:50%;border:3px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,0.4);box-sizing:border-box;}
.mapboxgl-ctrl-attrib{background:rgba(255,255,255,0.72);font-size:10px;}
.mapboxgl-ctrl-group{border-radius:8px;}
#fb{position:fixed;top:8px;left:50%;transform:translateX(-50%);background:rgba(20,20,20,0.6);color:#fff;font:11px -apple-system,"Segoe UI",Roboto,sans-serif;padding:3px 10px;border-radius:999px;z-index:9;pointer-events:none;}
</style></head><body>
<div id="m"></div>
<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
<script>
(function(){
  var STYLE = ${JSON.stringify(style)};
  var COLORS = ${JSON.stringify(MAP_COLORS)};
  var EMPTY = ${JSON.stringify(EMPTY_FC)};
  var CENTER = [${region.longitude}, ${region.latitude}];
  var ZOOM = ${zoom};
  var map = null;
  var layerIds = [];
  var sourceIds = [];
  var markerObjs = [];
  var focusId;
  var userDot = null, userDotEl = null, accAdded = false;

  function post(obj){
    try { if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) window.ReactNativeWebView.postMessage(JSON.stringify(obj)); } catch(e){}
  }

  function circle(c, r){
    var pts=[], steps=48;
    for (var i=0;i<steps;i++){ var a=(i/steps)*Math.PI*2;
      var dLat=(r*Math.cos(a))/111111;
      var dLng=(r*Math.sin(a))/(111111*Math.cos(c.latitude*Math.PI/180));
      pts.push([c.longitude+dLng, c.latitude+dLat]); }
    if(pts.length) pts.push(pts[0]);
    return {type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[pts]}};
  }

  function clearLayers(){
    layerIds.forEach(function(id){ if(map.getLayer(id)) map.removeLayer(id); });
    layerIds=[];
    markerObjs.forEach(function(mk){ mk.remove(); }); markerObjs=[];
    sourceIds.forEach(function(id){ if(map.getSource(id)) map.removeSource(id); });
    sourceIds=[];
  }

  window.__renderData = function(data){
    if(!map) { window.__pendingData = data; return; }
    clearLayers();
    (data.segments || []).forEach(function(seg, index){
      if (!seg.coordinates || seg.coordinates.length < 2) return;
      var id='seg-'+index;
      map.addSource(id,{type:'geojson',data:{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:seg.coordinates.map(function(c){return [c.longitude,c.latitude];})}}});
      sourceIds.push(id);
      var selected = data.selectedSegmentIndex===index;
      var dashed = !!(seg.generated||seg.pending);
      var color = seg.pending?COLORS.caution:(COLORS[seg.freedom]||COLORS.free);
      map.addLayer({id:id+'-casing',type:'line',source:id,layout:{'line-cap':'round','line-join':'round'},
        paint:{'line-color':COLORS.outline,'line-width':selected?12:9,'line-opacity':0.95}});
      layerIds.push(id+'-casing');
      var linePaint={'line-color':color,'line-width':selected?8:5,'line-opacity':1};
      if(dashed) linePaint['line-dasharray']=[2,2];
      map.addLayer({id:id+'-line',type:'line',source:id,layout:{'line-cap':'round','line-join':'round'},paint:linePaint});
      layerIds.push(id+'-line');
      if(data.segmentEditable){
        map.addLayer({id:id+'-hit',type:'line',source:id,layout:{'line-cap':'round'},paint:{'line-color':'#000','line-opacity':0,'line-width':44}});
        layerIds.push(id+'-hit');
        map.on('click', id+'-hit', function(e){ if(e.lngLat) post({type:'segmentPress',index:index,lat:e.lngLat.lat,lng:e.lngLat.lng}); });
      }
    });
    (data.markers || []).forEach(function(m){
      var el=document.createElement('div'); el.className='pin'; el.style.background=(m.color||COLORS.brand);
      if(m.label) el.title=m.label;
      var mk=new maplibregl.Marker({element:el,anchor:'center'}).setLngLat([m.coordinate.longitude,m.coordinate.latitude]).addTo(map);
      el.addEventListener('click',function(ev){ev.stopPropagation();post({type:'markerPress',id:m.id});});
      markerObjs.push(mk);
    });
    if(data.fitToRoute){
      var coords=[]; (data.segments||[]).forEach(function(s){ (s.coordinates||[]).forEach(function(c){coords.push([c.longitude,c.latitude]);}); });
      if(coords.length>1){ var b=coords.reduce(function(acc,c){acc[0][0]=Math.min(acc[0][0],c[0]);acc[0][1]=Math.min(acc[0][1],c[1]);acc[1][0]=Math.max(acc[1][0],c[0]);acc[1][1]=Math.max(acc[1][1],c[1]);return acc;},[[999,999],[-999,-999]]);
        map.fitBounds(b,{padding:44,animate:false}); }
    }
  };

  window.__setUserLocation = function(data){
    if(!map){ window.__pendingLocation = data; return; }
    if(data.userCoordinate){
      var p=[data.userCoordinate.longitude,data.userCoordinate.latitude];
      var color=data.locationStale?COLORS.muted:COLORS.location;
      if(!userDotEl){ userDotEl=document.createElement('div'); userDotEl.className='userdot';
        userDot=new maplibregl.Marker({element:userDotEl,anchor:'center'}).addTo(map); }
      userDot.setLngLat(p); userDotEl.style.background=color;
      if(!accAdded){ map.addSource('doggo-acc',{type:'geojson',data:EMPTY});
        map.addLayer({id:'doggo-acc-fill',type:'fill',source:'doggo-acc',paint:{'fill-color':color,'fill-opacity':0.09}});
        map.addLayer({id:'doggo-acc-line',type:'line',source:'doggo-acc',paint:{'line-color':color,'line-opacity':0.2,'line-width':1}});
        accAdded=true; }
      map.getSource('doggo-acc').setData(circle(data.userCoordinate, data.userAccuracy||0));
    } else {
      if(userDot){ userDot.remove(); userDot=null; userDotEl=null; }
      if(accAdded && map.getSource('doggo-acc')) map.getSource('doggo-acc').setData(EMPTY);
    }
    if(data.locationFocus && data.locationFocus.id!==focusId){ focusId=data.locationFocus.id; var c=data.locationFocus.coordinate; map.flyTo({center:[c.longitude,c.latitude],zoom:17}); }
  };

  function startMapLibre(){
    map = new maplibregl.Map({ container:'m', style: STYLE.styleUrl, center: CENTER, zoom: ZOOM,
      attributionControl:{compact:true} });
    map.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-left');
    map.on('click', function(e){ if(e.lngLat) post({type:'press',lat:e.lngLat.lat,lng:e.lngLat.lng}); });
    map.on('load', function(){
      post({type:'ready'});
      if(window.__pendingData){ var d=window.__pendingData; window.__pendingData=null; window.__renderData(d); }
      if(window.__pendingLocation){ var l=window.__pendingLocation; window.__pendingLocation=null; window.__setUserLocation(l); }
    });
  }

  // Repli Leaflet si WebGL/MapLibre indisponible.
  function startLeaflet(){
    var b=document.createElement('div'); b.id='fb'; b.textContent='Rendu raster · WebGL indisponible'; document.body.appendChild(b);
    var css=document.createElement('link'); css.rel='stylesheet'; css.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; document.head.appendChild(css);
    var s=document.createElement('script'); s.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    s.onload=function(){
      var mapL=L.map('m',{zoomControl:true,attributionControl:true,zoomSnap:0,zoomDelta:0.5}).setView([${region.latitude},${region.longitude}],ZOOM);
      if(mapL.attributionControl) mapL.attributionControl.setPrefix(false);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(mapL);
      var layers=[];
      window.__renderData=function(data){
        layers.forEach(function(l){mapL.removeLayer(l);}); layers=[];
        (data.segments||[]).forEach(function(seg,index){ if(!seg.coordinates||seg.coordinates.length<2)return;
          var pts=seg.coordinates.map(function(c){return [c.latitude,c.longitude];});
          var color=seg.pending?COLORS.caution:(COLORS[seg.freedom]||COLORS.free);
          layers.push(L.polyline(pts,{color:color,weight:data.selectedSegmentIndex===index?8:5,dashArray:(seg.generated||seg.pending)?'8 8':null}).addTo(mapL));
          if(data.segmentEditable){ var hit=L.polyline(pts,{weight:44,opacity:0}).addTo(mapL); hit.on('click',function(e){L.DomEvent.stopPropagation(e);post({type:'segmentPress',index:index,lat:e.latlng.lat,lng:e.latlng.lng});}); layers.push(hit); } });
        (data.markers||[]).forEach(function(m){ var el='<div class="pin" style="background:'+(m.color||COLORS.brand)+'"></div>';
          var mk=L.marker([m.coordinate.latitude,m.coordinate.longitude],{icon:L.divIcon({html:el,iconSize:[22,22],iconAnchor:[11,11],className:''})}).addTo(mapL);
          mk.on('click',function(){post({type:'markerPress',id:m.id});}); layers.push(mk); });
      };
      window.__setUserLocation=function(data){ /* position gérée simplement */ };
      post({type:'ready'});
      if(window.__pendingData){ var d=window.__pendingData; window.__pendingData=null; window.__renderData(d); }
    };
    document.body.appendChild(s);
  }

  if (window.maplibregl && maplibregl.supported && maplibregl.supported()) startMapLibre(); else startLeaflet();
})();
</script>
</body></html>`;
}

// ============ Native (iOS + Android): WebView + MapLibre ============

const NativeMapImpl: React.FC<Props> = (props) => {
  const WebView = require("react-native-webview").WebView;
  const ref = useRef<any>(null);
  const readyRef = useRef(false);

  const region = props.initialRegion || { latitude: 48.85, longitude: 2.35, latitudeDelta: 0.1, longitudeDelta: 0.1 };
  const style = useMemo(() => resolveMapStyle(styleEnv()), []);
  const html = useMemo(() => buildHtml(region, style), [region.latitude, region.longitude, region.latitudeDelta, region.longitudeDelta, style]);

  const pushData = () => {
    if (!ref.current || !readyRef.current) return;
    const data = JSON.stringify({ segments: props.segments || [], markers: props.markers || [], segmentEditable: !!props.onSegmentPress, selectedSegmentIndex: props.selectedSegmentIndex, fitToRoute: props.fitToRoute, fitRevision: props.fitRevision });
    ref.current.injectJavaScript(`window.__renderData(${data}); true;`);
  };

  useEffect(() => { pushData(); }, [props.segments, props.markers, props.onSegmentPress, props.selectedSegmentIndex, props.fitToRoute, props.fitRevision]);
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

// ============ Web: chargement de MapLibre (repli Leaflet) ============

let maplibreLoading: Promise<any> | null = null;
function loadMapLibre(): Promise<any> {
  // @ts-ignore
  if (typeof window === "undefined") return Promise.reject("no window");
  // @ts-ignore
  if (window.maplibregl) return Promise.resolve(window.maplibregl);
  if (maplibreLoading) return maplibreLoading;
  maplibreLoading = new Promise((resolve, reject) => {
    const doc = document;
    if (!doc.getElementById("maplibre-css")) {
      const link = doc.createElement("link");
      link.id = "maplibre-css"; link.rel = "stylesheet";
      link.href = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css";
      doc.head.appendChild(link);
    }
    const s = doc.createElement("script");
    s.src = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js";
    s.async = true;
    s.onload = () => resolve((window as any).maplibregl);
    s.onerror = (e) => reject(e);
    doc.body.appendChild(s);
  });
  return maplibreLoading;
}

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
      link.id = "leaflet-css"; link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      doc.head.appendChild(link);
    }
    const s = doc.createElement("script");
    s.id = "leaflet-js"; s.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"; s.async = true;
    s.onload = () => resolve((window as any).L);
    s.onerror = (e) => reject(e);
    doc.body.appendChild(s);
  });
  return leafletLoading;
}

const WebMapLibreImpl: React.FC<Props> = (props) => {
  const containerRef = useRef<any>(null);
  const mapRef = useRef<any>(null);
  const layerIdsRef = useRef<string[]>([]);
  const sourceIdsRef = useRef<string[]>([]);
  const markersRef = useRef<any[]>([]);
  const accRef = useRef(false);
  const userDotRef = useRef<any>(null);
  const focusRef = useRef<number | undefined>(undefined);
  const latestProps = useRef(props); latestProps.current = props;
  const style = useMemo(() => resolveMapStyle(styleEnv()), []);

  const clearLayers = useCallback(() => {
    const map = mapRef.current; if (!map) return;
    layerIdsRef.current.forEach((id) => { if (map.getLayer(id)) map.removeLayer(id); });
    markersRef.current.forEach((m) => m.remove());
    sourceIdsRef.current.forEach((id) => { if (map.getSource(id)) map.removeSource(id); });
    layerIdsRef.current = []; sourceIdsRef.current = []; markersRef.current = [];
  }, []);

  const renderLayers = useCallback(() => {
    const map = mapRef.current; if (!map) return;
    clearLayers();
    const data = latestProps.current;
    (data.segments || []).forEach((seg, index) => {
      if (!seg.coordinates || seg.coordinates.length < 2) return;
      const id = `seg-${index}`;
      map.addSource(id, { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: seg.coordinates.map((c) => [c.longitude, c.latitude]) } } });
      sourceIdsRef.current.push(id);
      const selected = data.selectedSegmentIndex === index;
      const dashed = !!(seg.generated || seg.pending);
      const color = seg.pending ? colors.warning : freedomColor[seg.freedom];
      map.addLayer({ id: id + "-casing", type: "line", source: id, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": colors.surfaceSecondary, "line-width": selected ? 12 : 9, "line-opacity": 0.95 } });
      const linePaint: any = { "line-color": color, "line-width": selected ? 8 : 5, "line-opacity": 1 };
      if (dashed) linePaint["line-dasharray"] = [2, 2];
      map.addLayer({ id: id + "-line", type: "line", source: id, layout: { "line-cap": "round", "line-join": "round" }, paint: linePaint });
      layerIdsRef.current.push(id + "-casing", id + "-line");
      if (data.onSegmentPress) {
        map.addLayer({ id: id + "-hit", type: "line", source: id, layout: { "line-cap": "round" }, paint: { "line-color": "#000", "line-opacity": 0, "line-width": 44 } });
        layerIdsRef.current.push(id + "-hit");
        map.on("click", id + "-hit", (e: any) => { if (e.lngLat) latestProps.current.onSegmentPress?.(index, { latitude: e.lngLat.lat, longitude: e.lngLat.lng }); });
      }
    });
    (data.markers || []).forEach((m) => {
      const el = document.createElement("div");
      el.className = "pin"; el.style.background = m.color || colors.brandPrimary;
      if (m.label) el.title = m.label;
      const mk = new (window as any).maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([m.coordinate.longitude, m.coordinate.latitude]).addTo(map);
      el.addEventListener("click", (ev) => { ev.stopPropagation(); m.onPress?.(); });
      markersRef.current.push(mk);
    });
    if (data.fitToRoute) {
      const coords: [number, number][] = [];
      (data.segments || []).forEach((s) => (s.coordinates || []).forEach((c) => coords.push([c.longitude, c.latitude])));
      if (coords.length > 1) {
        const b = coords.reduce((acc, c) => { acc[0][0] = Math.min(acc[0][0], c[0]); acc[0][1] = Math.min(acc[0][1], c[1]); acc[1][0] = Math.max(acc[1][0], c[0]); acc[1][1] = Math.max(acc[1][1], c[1]); return acc; }, [[999, 999], [-999, -999]]);
        map.fitBounds(b, { padding: 44, animate: false });
      }
    }
  }, [clearLayers]);

  const renderLocation = useCallback(() => {
    const map = mapRef.current; if (!map) return;
    const data = latestProps.current;
    if (data.userCoordinate) {
      const p = [data.userCoordinate.longitude, data.userCoordinate.latitude];
      const color = data.locationStale ? colors.muted : colors.location;
      if (!userDotRef.current) {
        const el = document.createElement("div"); el.className = "userdot";
        el.setAttribute("data-testid", `${data.testID}-user-position`);
        userDotRef.current = new (window as any).maplibregl.Marker({ element: el, anchor: "center" }).addTo(map);
      }
      userDotRef.current.setLngLat(p); (userDotRef.current.getElement() as HTMLElement).style.background = color;
      if (!accRef.current) {
        map.addSource("doggo-acc", { type: "geojson", data: EMPTY_FC });
        map.addLayer({ id: "doggo-acc-fill", type: "fill", source: "doggo-acc", paint: { "fill-color": color, "fill-opacity": 0.09 } });
        map.addLayer({ id: "doggo-acc-line", type: "line", source: "doggo-acc", paint: { "line-color": color, "line-opacity": 0.2, "line-width": 1 } });
        accRef.current = true;
      }
      map.getSource("doggo-acc").setData(circlePolygon(data.userCoordinate, data.userAccuracy || 0));
    } else {
      if (userDotRef.current) { userDotRef.current.remove(); userDotRef.current = null; }
      if (accRef.current && map.getSource("doggo-acc")) map.getSource("doggo-acc").setData(EMPTY_FC);
    }
    if (data.locationFocus && data.locationFocus.id !== focusRef.current) {
      focusRef.current = data.locationFocus.id;
      const c = data.locationFocus.coordinate;
      map.flyTo({ center: [c.longitude, c.latitude], zoom: 17 });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const region = props.initialRegion || { latitude: 48.85, longitude: 2.35, latitudeDelta: 0.1, longitudeDelta: 0.1 };
    loadMapLibre().then((mlgl) => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      if (!(mlgl.supported && mlgl.supported())) return; // -> repli Leaflet géré par le parent
      const map = new mlgl.Map({ container: containerRef.current, style: style.styleUrl, center: [region.longitude, region.latitude], zoom: calcZoom(region.latitudeDelta, region.longitudeDelta), attributionControl: { compact: true } });
      map.addControl(new mlgl.NavigationControl({ showCompass: false }), "top-left");
      map.on("click", (e: any) => { if (e.lngLat) latestProps.current.onPress?.({ latitude: e.lngLat.lat, longitude: e.lngLat.lng }); });
      map.on("load", () => { renderLayers(); renderLocation(); });
      mapRef.current = map;
    }).catch(() => {});
    return () => {
      cancelled = true;
      if (mapRef.current) { try { mapRef.current.remove(); } catch {} mapRef.current = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (mapRef.current) renderLayers(); }, [props.segments, props.markers, props.selectedSegmentIndex, props.onSegmentPress, props.fitToRoute, props.fitRevision, renderLayers]);
  useEffect(() => { if (mapRef.current) renderLocation(); }, [props.userCoordinate, props.userAccuracy, props.locationStale, props.locationFocus, renderLocation]);

  return (
    <View style={[{ flex: 1, backgroundColor: colors.brandTertiary, overflow: "hidden" }, props.style]} testID={props.testID}
      onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true} onResponderTerminationRequest={() => false}>
      {/* @ts-ignore */}
      <div ref={(el: any) => { containerRef.current = el; }} style={{ width: "100%", height: "100%", touchAction: "none" }} />
    </View>
  );
};

// Repli Leaflet pour le Web (si WebGL indisponible)
const WebLeafletImpl: React.FC<Props> = (props) => {
  const containerRef = useRef<any>(null);
  const mapRef = useRef<any>(null);
  const layersRef = useRef<any[]>([]);
  const latestProps = useRef(props); latestProps.current = props;
  useEffect(() => {
    let cancelled = false;
    loadLeaflet().then((L) => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      const region = props.initialRegion || { latitude: 48.85, longitude: 2.35, latitudeDelta: 0.1, longitudeDelta: 0.1 };
      const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true, zoomSnap: 0, zoomDelta: 0.5 })
        .setView([region.latitude, region.longitude], calcZoom(region.latitudeDelta, region.longitudeDelta));
      if (map.attributionControl) map.attributionControl.setPrefix(false);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" }).addTo(map);
      map.on("click", (e: any) => { latestProps.current.onPress?.({ latitude: e.latlng.lat, longitude: e.latlng.lng }); });
      mapRef.current = map;
    }).catch(() => {});
    return () => { cancelled = true; if (mapRef.current) { try { mapRef.current.remove(); } catch {} mapRef.current = null; } };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const L = (window as any).L, map = mapRef.current; if (!L || !map) return;
    layersRef.current.forEach((l) => { try { map.removeLayer(l); } catch {} }); layersRef.current = [];
    props.segments?.forEach((seg, index) => {
      if (!seg.coordinates || seg.coordinates.length < 2) return;
      const pts = seg.coordinates.map((c) => [c.latitude, c.longitude]);
      layersRef.current.push(L.polyline(pts, { color: seg.pending ? colors.warning : freedomColor[seg.freedom], weight: props.selectedSegmentIndex === index ? 8 : 5 }).addTo(map));
    });
    props.markers?.forEach((m) => {
      const html = `<div class="pin" style="background:${m.color || colors.brandPrimary}"></div>`;
      layersRef.current.push(L.marker([m.coordinate.latitude, m.coordinate.longitude], { icon: L.divIcon({ html, iconSize: [22, 22], iconAnchor: [11, 11], className: "" }) }).addTo(map));
    });
  }, [props.segments, props.markers, props.selectedSegmentIndex]);
  return (
    <View style={[{ flex: 1, backgroundColor: colors.brandTertiary, overflow: "hidden" }, props.style]} testID={props.testID}
      onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true} onResponderTerminationRequest={() => false}>
      {/* @ts-ignore */}
      <div ref={(el: any) => { containerRef.current = el; }} style={{ width: "100%", height: "100%", touchAction: "none" }} />
    </View>
  );
};

const WebMapImpl: React.FC<Props> = (props) => {
  const [mode, setMode] = useState<"pending" | "maplibre" | "leaflet">("pending");
  useEffect(() => {
    let cancelled = false;
    loadMapLibre().then((mlgl) => { if (!cancelled) setMode(mlgl.supported && mlgl.supported() ? "maplibre" : "leaflet"); })
      .catch(() => { if (!cancelled) setMode("leaflet"); });
    return () => { cancelled = true; };
  }, []);
  if (mode === "pending") return <View style={[{ flex: 1 }, props.style]} testID={props.testID} />;
  return mode === "maplibre" ? <WebMapLibreImpl {...props} /> : <WebLeafletImpl {...props} />;
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

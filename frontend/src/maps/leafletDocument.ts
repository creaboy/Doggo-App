import { colors } from '../theme';
import type { Region } from './types';
import { PINCH_ZOOM_SCRIPT } from './pinchZoom';

export const FOCUS_DEFAULT_ZOOM = 17;
export const DEFAULT_REGION: Region = { latitude: 48.85, longitude: 2.35, latitudeDelta: 0.1, longitudeDelta: 0.1 };

export const LIBERTY_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
export const voyagerAvailable = () => !!process.env.EXPO_PUBLIC_CARTO_API_KEY?.trim();

function cartoTileUrl(): string | null {
  const key = process.env.EXPO_PUBLIC_CARTO_API_KEY?.trim();
  return key ? `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}` : null;
}

function calcZoom(latDelta: number, lngDelta: number): number {
  return Math.max(2, Math.min(18, Math.round(Math.log2(360 / Math.max(latDelta, lngDelta / 2)))));
}

export function buildMapDocument(region: Region): string {
  const zoom = calcZoom(region.latitudeDelta, region.longitudeDelta);
  return `<!doctype html><html><head>
<meta charset="utf-8" />
<meta name="viewport" content="initial-scale=1.0,maximum-scale=1.0,user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.css" />
<style>html,body,#m{margin:0;padding:0;height:100%;width:100%;background:#F1F4EE;}
.pin{width:24px;height:24px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.4);box-sizing:border-box;display:flex;align-items:center;justify-content:center;color:#fff;font:700 12px system-ui,sans-serif;}
.leaflet-container{background:#F1F4EE;touch-action:none;overscroll-behavior:contain;}
</style></head><body>
<div id="m" data-testid="doggo-leaflet"></div>
<script>
function post(obj) {
  obj.doggoMap = true;
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(obj));
  // srcdoc's Location.origin is "null"; the host iframe inherits its parent's origin.
  else window.parent.postMessage(obj, window.parent.location.origin);
}
window.addEventListener('error', function(){ post({type:'error'}); });
window.addEventListener('unhandledrejection', function(){ post({type:'error'}); });
</script>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" onerror="post({type:'error'})"></script>
<script src="https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js" onerror="post({type:'error'})"></script>
<script src="https://unpkg.com/@maplibre/maplibre-gl-leaflet@0.1.4/dist/leaflet-maplibre-gl.js" onerror="post({type:'error'})"></script>
<script>
(function(){
  if (!window.L) return;
  var map = L.map('m', {zoomControl: true, attributionControl: true, touchZoom: true, zoomSnap: 0, minZoom: 1, maxZoom: 20, bounceAtZoomLimits: false, maxBounds: [[-85.0511, -Infinity], [85.0511, Infinity]], maxBoundsViscosity: 1}).setView([${region.latitude}, ${region.longitude}], ${zoom});
  ${PINCH_ZOOM_SCRIPT}
  try { installPinchZoom(map, L); } catch (error) { console.warn('Pinch enhancement unavailable', error); }
  var voyagerUrl = ${JSON.stringify(cartoTileUrl())};
  var basemapLayer = null;
  var basemapName;
  var basemapGeneration = 0;
  function setBasemap(name) {
    name = name === 'voyager' ? 'voyager' : 'liberty';
    if (name === basemapName) return;
    if (name === 'voyager' && !voyagerUrl) { post({type:'error', message:'CARTO Voyager necessite une cle CARTO. Liberty reste disponible.'}); return; }
    var generation = ++basemapGeneration;
    if (basemapLayer) { map.removeLayer(basemapLayer); basemapLayer = null; }
    basemapName = name;
    var failed = false;
    function fail() { if (generation === basemapGeneration) { failed = true; post({type:'error'}); } }
    function loaded() { if (generation === basemapGeneration && !failed) post({type:'tilesLoaded'}); }
    post({type:'basemapLoading'});
    try {
      if (name === 'voyager') {
        basemapLayer = L.tileLayer(voyagerUrl, {maxZoom:20, subdomains:'abcd', attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> &copy; <a href="https://carto.com/attribution/">CARTO</a>'})
          .on('loading', function(){ failed = false; })
          .on('tileerror', fail).on('load', loaded).addTo(map);
      } else {
        if (!L.maplibreGL) throw new Error('MapLibre unavailable');
        basemapLayer = L.maplibreGL({updateInterval:16, style:${JSON.stringify(LIBERTY_STYLE_URL)}, attributionControl:{customAttribution:'<a href="https://openfreemap.org/">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}});
        // Keep the adapter's live vector-camera updates during pinch and inertia.
        // Transforming a frozen canvas here prevents labels/tiles from rendering.
        basemapLayer.addTo(map);
        var gl = basemapLayer.getMaplibreMap();
        gl.on('error', fail);
        gl.on('idle', function(){ if (gl.loaded()) loaded(); });
      }
      document.getElementById('m').setAttribute('data-basemap', name);
    } catch (error) { fail(); }
  }
  var layers = [];
  var sceneKey;
  var userMarker = null;
  var accuracyCircle = null;
  var focusId;
  var fitKey = '';
  map.createPane('doggo-user-location').style.zIndex = '650';

  map.on('click', function(e){ post({type:'press', lat:e.latlng.lat, lng:e.latlng.lng}); });

  window.__renderData = function(data){
    layers.forEach(function(l){ map.removeLayer(l); });
    layers = [];
    var all = [];
    (data.segments || []).forEach(function(seg,index){
      if (!seg.coordinates || seg.coordinates.length < 2) return;
      var pts = seg.coordinates.map(function(c){ return [c.latitude, c.longitude]; });
      all = all.concat(pts);
      var color = seg.freedom === 'free' ? '${colors.success}' : seg.freedom === 'caution' ? '${colors.warning}' : '${colors.error}';
      var selected = data.selectedSegmentIndex===index;
      var casing = L.polyline(pts, {color:'${colors.surfaceSecondary}', weight: selected ? 12 : 8, opacity:.95, interactive:false}).addTo(map);
      layers.push(casing);
      var pl = L.polyline(pts, {color: seg.pending ? '${colors.warning}' : color, weight: selected ? 8 : 5, dashArray:seg.generated || seg.pending ? '8 8' : null}).addTo(map);
      layers.push(pl);
      if(data.segmentEditable){ var hit=L.polyline(pts,{weight:44,opacity:0}).addTo(map); hit.on('click',function(e){L.DomEvent.stopPropagation(e);post({type:'segmentPress',index:index,lat:e.latlng.lat,lng:e.latlng.lng});});layers.push(hit); }
    });
    (data.markers || []).forEach(function(m){
      var selected = m.pointIndex !== undefined && m.pointIndex === data.selectedPointIndex;
      var size = selected ? 30 : 24;
      var pin = document.createElement('div');
      pin.className = 'pin'; pin.style.width = pin.style.height = size+'px';
      pin.style.backgroundColor = m.color || '${colors.brandPrimary}';
      pin.style.borderColor = selected ? '${colors.location}' : '${colors.surfaceSecondary}';
      pin.textContent = m.badge || '';
      var icon = L.divIcon({html: pin, iconSize:[size,size], iconAnchor:[size/2,size/2], className:''});
      var mk = L.marker([m.coordinate.latitude, m.coordinate.longitude], {icon: icon, title: m.label || '', zIndexOffset: selected ? 1000 : 0}).addTo(map);
      mk.on('click', function(e){ L.DomEvent.stopPropagation(e); post({type:'markerPress', id: m.id}); });
      if (m.label) { var label = document.createElement('span'); label.textContent = m.label; mk.bindTooltip(label); }
      layers.push(mk);
    });
    // Framing is explicit: only when the view asks for it, and only once per fitRevision.
    if(!data.fitToRoute) fitKey='';
    else if(all.length>1 && fitKey!==String(data.fitRevision===undefined?'initial':data.fitRevision)){
      fitKey = String(data.fitRevision===undefined?'initial':data.fitRevision);
      map.fitBounds(L.latLngBounds(all), {padding:[44,44]});
    }
    var canvas = document.getElementById('m');
    canvas.setAttribute('data-route-segments', String((data.segments || []).length));
    canvas.setAttribute('data-route-points', String((data.markers || []).length));
    canvas.setAttribute('data-selected-segment', String(data.selectedSegmentIndex ?? ''));
    canvas.setAttribute('data-selected-point', String(data.selectedPointIndex ?? ''));
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
    if(data.locationFocus && data.locationFocus.id!==focusId){focusId=data.locationFocus.id;var c=data.locationFocus.coordinate;map.setView([c.latitude,c.longitude], data.locationFocus.zoom || 17);}
  };

  window.__doggoUpdate = function(data) {
    setBasemap(data.basemap);
    var key = JSON.stringify(data.scene);
    if (data.scene && key !== sceneKey) {
      sceneKey = key;
      window.__renderData(data.scene);
    }
    window.__setUserLocation(data);
  };
  window.addEventListener('message', function(e) {
    if (e.source !== window.parent || e.origin !== window.parent.location.origin || !e.data?.doggoMap) return;
    window.__doggoUpdate(e.data.payload);
    if (e.data.requestReady) post({type:'ready'});
  });
  window.addEventListener('resize', function(){ map.invalidateSize(); });
  post({type:'ready'});
})();
</script>
</body></html>`;
}

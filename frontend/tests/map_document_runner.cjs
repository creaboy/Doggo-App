const assert = require('assert/strict');
const path = require('path');
const vm = require('vm');
const { makeLoader } = require('./ts_loader.cjs');

const { buildMapDocument, DEFAULT_REGION } = makeLoader().load(path.join(__dirname, '../src/maps/leafletDocument.ts'));

function startMap(native = false, apiKey = 'test-key') {
  const saved = process.env.EXPO_PUBLIC_CARTO_API_KEY;
  if (apiKey) process.env.EXPO_PUBLIC_CARTO_API_KEY = apiKey;
  else delete process.env.EXPO_PUBLIC_CARTO_API_KEY;
  const html = buildMapDocument(DEFAULT_REGION);
  if (saved === undefined) delete process.env.EXPO_PUBLIC_CARTO_API_KEY;
  else process.env.EXPO_PUBLIC_CARTO_API_KEY = saved;
  const messages = [], layers = [], fits = [], views = [], removed = [], listeners = {};
  const canvas = { attributes: {}, setAttribute(k, v) { this.attributes[k] = v; } };
  const map = {
    setView(p, zoom) { views.push({ p, zoom }); return this; },
    createPane() { return { style: {} }; }, on(event, cb) { listeners[event] = cb; },
    removeLayer(layer) { removed.push(layer); }, fitBounds(bounds) { fits.push(bounds); }, invalidateSize() {},
  };
  function layer(kind, points, options) {
    const value = { kind, points, options, events: {}, addTo() { layers.push(this); return this; },
      on(event, cb) { this.events[event] = cb; return this; }, bindTooltip(label) { this.label = label; return this; },
      setLatLng(p) { this.points = p; return this; }, setStyle(options) { Object.assign(this.options, options); return this; },
      setRadius(radius) { this.radius = radius; return this; }, bringToBack() { return this; },
    };
    return value;
  }
  const window = { location: { origin: 'https://doggo.test' }, parent: { postMessage(message) { messages.push(message); } },
    addEventListener(event, cb) { listeners[event] = cb; },
  };
  if (native) window.ReactNativeWebView = { postMessage(message) { messages.push(JSON.parse(message)); } };
  window.parent.location = window.location;
  // An iframe srcdoc inherits the parent's security origin, but Location.origin is "null".
  if (!native) window.location = { origin: 'null' };
  const L = { map: () => map, tileLayer: (url, options) => layer('tiles', url, options),
    polyline: (pts, opts) => layer('line', pts, opts), marker: (pts, opts) => layer('marker', pts, opts),
    circleMarker: (pts, opts) => layer('user', pts, opts), circle: (pts, opts) => layer('accuracy', pts, opts),
    divIcon: opts => opts, latLngBounds: pts => pts, DomEvent: { stopPropagation() {} },
  };
  window.L = L;
  const context = vm.createContext({ window, L, document: { getElementById: () => canvas,
    createElement: () => ({ style: {}, textContent: '' }) } });
  // Execute the exact inline scripts shipped to both iframe and WebView.
  for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) vm.runInContext(match[1], context);
  return { window, messages, layers, fits, views, removed, listeners, canvas };
}

const scene = () => ({ revision: 1, segmentEditable: true, fitToRoute: true, fitRevision: 1,
  selectedSegmentIndex: 0, selectedPointIndex: 1,
  segments: [{ freedom: 'free', coordinates: [{ latitude: 48.85, longitude: 2.35 }, { latitude: 48.86, longitude: 2.36 }] }],
  markers: [{ id: 'point-1', pointIndex: 1, coordinate: { latitude: 48.86, longitude: 2.36 }, badge: '<b>1</b>', label: '<img src=x>' }],
});

for (const native of [false, true]) {
  const m = startMap(native);
  assert.equal(m.messages.at(-1).type, 'ready');
  const tiles = m.layers.find(l => l.kind === 'tiles');
  assert.match(tiles.points, /cartocdn\.com.*\?key=test-key$/);
  assert.match(tiles.options.attribution, /OpenStreetMap contributors/);
  assert.match(tiles.options.attribution, /CARTO/);
  const data = { scene: scene(), userCoordinate: { latitude: 48.85, longitude: 2.35 }, userAccuracy: 12,
    locationFocus: { id: 1, coordinate: { latitude: 48.85, longitude: 2.35 }, zoom: 17 } };
  m.window.__doggoUpdate(data);
  assert.equal(m.fits.length, 1);
  assert.equal(m.views.length, 2);
  const linesBefore = m.layers.filter(l => l.kind === 'line').length;
  // GPS-only updates must not rebuild route layers or reset a user's pan/zoom.
  m.window.__doggoUpdate({ ...data, userCoordinate: { latitude: 48.851, longitude: 2.351 } });
  assert.equal(m.layers.filter(l => l.kind === 'line').length, linesBefore);
  assert.equal(m.fits.length, 1);
  assert.equal(m.views.length, 2);
  const marker = m.layers.find(l => l.kind === 'marker');
  assert.equal(marker.options.icon.html.textContent, '<b>1</b>');
  assert.equal(marker.options.icon.iconSize[0], 30);
  assert.equal(marker.label.textContent, '<img src=x>');
  marker.events.click({});
  assert.equal(m.messages.at(-1).id, 'point-1');
  m.layers.find(l => l.kind === 'line' && l.options.opacity === 0).events.click({ latlng: { lat: 48.85, lng: 2.35 } });
  assert.equal(m.messages.at(-1).type, 'segmentPress');
  assert.equal(m.messages.at(-1).index, 0);
  m.listeners.click({ latlng: { lat: 48.852, lng: 2.352 } });
  assert.equal(m.messages.at(-1).type, 'press');
  m.window.__doggoUpdate({ scene: { ...data.scene, revision: 2, selectedPointIndex: undefined } });
  assert.equal(m.fits.length, 1, 'editing must not recenter the camera');
  assert.ok(m.removed.some(l => l.kind === 'user'), 'missing GPS clears its marker');
  m.window.__doggoUpdate({ scene: { ...data.scene, revision: 3, fitRevision: 2 } });
  assert.equal(m.fits.length, 2);
  const count = m.messages.length;
  m.listeners.message({ source: {}, origin: 'https://doggo.test', data: { doggoMap: true, payload: data, requestReady: true } });
  assert.equal(m.messages.length, count, 'reject messages from unrelated windows');
  m.listeners.message({ source: m.window.parent, origin: 'https://other.test', data: { doggoMap: true, payload: data, requestReady: true } });
  assert.equal(m.messages.length, count, 'reject messages from other origins');
  m.listeners.message({ source: m.window.parent, origin: 'https://doggo.test', data: { doggoMap: true, payload: data, requestReady: true } });
  assert.equal(m.messages.at(-1).type, 'ready', 'late host listeners can repeat the handshake');
  tiles.events.tileerror();
  assert.equal(m.messages.at(-1).type, 'error');
  tiles.events.load();
  assert.equal(m.messages.at(-1).type, 'error', 'completing a failed tile batch must not hide the error');
  tiles.events.loading();
  tiles.events.load();
  assert.equal(m.messages.at(-1).type, 'tilesLoaded');
  console.log(`PASS: shared Leaflet editing, camera, GPS, attribution and transport (${native ? 'native' : 'web'})`);
}

const missingKey = startMap(false, '');
assert.equal(missingKey.layers.some(l => l.kind === 'tiles'), false);
assert.ok(missingKey.messages.some(m => m.type === 'error'));
missingKey.window.__doggoUpdate({ scene: scene() });
assert.equal(missingKey.canvas.attributes['data-route-segments'], '1');
console.log('PASS: missing CARTO key preserves route overlays and reports the unavailable basemap');

// Runs inside the shared map document. Keep this function self-contained.
// Leaflet 1.9.4's touch handler supplies the projection/gesture lifecycle;
// only its pinch movement and release are customized here.
export function installPinchZoom(map: any, L: any) {
  const touch = map.touchZoom;
  if (!touch) return;
  const sensitivity = 1.8;
  let frame = 0;
  let coasting = false;
  let velocity = 0;
  let lastTime = 0;
  let lastZoom = 0;
  let delta: any;
  const start = touch._onTouchStart;
  const stop = map._stop;
  const clamp = (zoom: number) => Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), zoom));
  const eventTime = (event: any) => Number.isFinite(event.timeStamp) && event.timeStamp > 0 ? event.timeStamp : performance.now();

  const detach = () => {
    L.DomEvent.off(document, 'touchmove', touch._onTouchMove, touch);
    L.DomEvent.off(document, 'touchend touchcancel', touch._onTouchEnd, touch);
  };
  const render = () => {
    frame = 0;
    map._move(touch._center, touch._zoom, { pinch: true, round: false });
  };
  const finish = () => {
    coasting = false;
    cancelAnimationFrame(frame);
    frame = 0;
    render();
    // Commit raster tile levels after fractional pinch frames, then end the gesture.
    map.fire('zoom');
    map._moveEnd(true);
  };
  const cancelCoast = () => { if (coasting) finish(); };
  const centerAt = (zoom: number) => map.options.touchZoom === 'center' ? touch._startLatLng
    : map.unproject(map.project(touch._pinchStartLatLng, zoom).subtract(delta), zoom);

  touch.disable();
  touch._onTouchStart = function (event: any) {
    cancelCoast();
    if (event.touches?.length === 2 && touch._zooming) {
      detach();
      touch._zooming = false;
      if (touch._moved) finish();
    }
    start.call(touch, event);
    if (event.touches?.length === 2 && touch._zooming) {
      velocity = 0;
      lastZoom = touch._startZoom;
      lastTime = eventTime(event);
    }
  };
  touch._onTouchMove = function (event: any) {
    if (!touch._zooming || event.touches?.length !== 2) return;
    const a = map.mouseEventToContainerPoint(event.touches[0]);
    const b = map.mouseEventToContainerPoint(event.touches[1]);
    const scale = a.distanceTo(b) / touch._startDist;
    if (!Number.isFinite(scale) || scale <= 0) return;
    touch._zoom = clamp(touch._startZoom + Math.log2(scale) * sensitivity);
    delta = a.add(b).divideBy(2).subtract(touch._centerPoint);
    touch._center = centerAt(touch._zoom);
    const now = eventTime(event);
    const elapsed = now - lastTime;
    if (elapsed > 0) {
      const speed = Math.max(-0.018, Math.min(0.018, (touch._zoom - lastZoom) / elapsed));
      velocity = speed * velocity < 0 ? speed : speed * 0.65 + velocity * 0.35;
    }
    lastTime = now;
    lastZoom = touch._zoom;
    if (!touch._moved) {
      if (Math.abs(touch._zoom - touch._startZoom) < 0.002 && delta.x === 0 && delta.y === 0) return;
      touch._moved = true;
      map._moveStart(true, false);
    }
    if (!frame) frame = requestAnimationFrame(render);
    L.DomEvent.preventDefault(event);
  };
  touch._onTouchEnd = function (event: any) {
    if (!touch._zooming) return;
    const cancelled = event.type === 'touchcancel' || event.type === 'pointercancel';
    // Fingers are usually lifted in two separate events. Wait for the last one;
    // a finger held still also lets release velocity expire naturally.
    if (!cancelled && event.touches?.length) return;
    detach();
    touch._zooming = false;
    if (!touch._moved) return;
    cancelAnimationFrame(frame);
    frame = 0;
    const speed = cancelled || eventTime(event) - lastTime > 160 ? 0 : velocity;
    if (Math.abs(speed) < 0.0006) { finish(); return; }
    const decay = 180 + Math.min(240, Math.abs(speed) * 16000);
    const extra = Math.sign(speed) * Math.min(3, Math.abs(speed) * decay);
    const from = touch._zoom;
    const target = clamp(from + extra);
    if (Math.abs(target - from) < 0.001) { finish(); return; }
    const began = performance.now();
    const duration = Math.min(1200, decay * 4);
    const normalization = 1 - Math.exp(-duration / decay);
    coasting = true;
    const tick = (time: number) => {
      const elapsed = Math.min(duration, time - began);
      touch._zoom = from + (target - from) * (1 - Math.exp(-elapsed / decay)) / normalization;
      touch._center = centerAt(touch._zoom);
      render();
      if (elapsed < duration) frame = requestAnimationFrame(tick);
      else finish();
    };
    frame = requestAnimationFrame(tick);
  };
  map._stop = function () { cancelCoast(); return stop.call(map); };
  touch.enable();
  map.on('unload', () => { cancelAnimationFrame(frame); coasting = false; detach(); });
}

// During a pinch, transform the already rendered vector canvas like Leaflet's
// raster tiles. Rebuilding vector labels/tiles on every finger movement stalls
// low-powered devices; synchronize MapLibre's camera once the gesture ends.
export function installVectorPinchTransform(layer: any, map: any, L: any) {
  const sync = layer._pinchZoom;
  if (!sync) return;
  layer._pinchZoom = function (event: any) {
    if (!event.pinch) { sync.call(layer, event); return; }
    const gl = layer.getMaplibreMap();
    const scale = map.getZoomScale(map.getZoom(), gl.getZoom() + 1);
    const center = map.latLngToLayerPoint(gl.getCenter());
    const topLeft = center.subtract(layer.getSize().multiplyBy(scale / 2));
    const offset = topLeft.subtract(L.DomUtil.getPosition(layer._container));
    L.DomUtil.setTransform(gl.getCanvas(), offset, scale);
  };
}

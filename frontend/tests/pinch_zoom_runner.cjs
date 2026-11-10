const assert = require('assert/strict');
const path = require('path');
const vm = require('vm');
const { makeLoader } = require('./ts_loader.cjs');
const { PINCH_ZOOM_SCRIPT } = makeLoader().load(path.join(__dirname, '../src/maps/pinchZoom.ts'));
const { installPinchZoom } = vm.runInThisContext(`(function(){${PINCH_ZOOM_SCRIPT}; return { installPinchZoom };})()`);

class Point {
  constructor(x, y) { this.x = x; this.y = y; }
  add(p) { return new Point(this.x + p.x, this.y + p.y); }
  subtract(p) { return new Point(this.x - p.x, this.y - p.y); }
  divideBy(value) { return new Point(this.x / value, this.y / value); }
  multiplyBy(value) { return new Point(this.x * value, this.y * value); }
  distanceTo(p) { return Math.hypot(this.x - p.x, this.y - p.y); }
}

const saved = Object.fromEntries(['document', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
let now = 0, nextFrame = 0;
const frames = new Map();
Object.defineProperty(globalThis, 'document', { value: {}, configurable: true });
Object.defineProperty(globalThis, 'performance', { value: { now: () => now }, configurable: true });
globalThis.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
globalThis.cancelAnimationFrame = id => frames.delete(id);

function advance(milliseconds) {
  now += milliseconds;
  const pending = [...frames.values()]; frames.clear();
  for (const callback of pending) callback(now);
}
function createMap(zoom = 12) {
  const listeners = {};
  const map = {
    zoom, center: new Point(0, 0), options: { touchZoom: true }, ended: 0,
    getMinZoom: () => 1, getMaxZoom: () => 20,
    mouseEventToContainerPoint: p => new Point(p.x, p.y),
    project: (p, z) => new Point(p.x * 2 ** z, p.y * 2 ** z),
    unproject: (p, z) => new Point(p.x / 2 ** z, p.y / 2 ** z),
    _stop() {}, _moveStart() {}, fire() {}, _moveEnd() { this.ended++; },
    _move(center, z) { this.center = center; this.zoom = z; }, on(event, callback) { listeners[event] = callback; },
  };
  const touch = {
    disable() {}, enable() {},
    _onTouchStart(event) {
      if (event.touches.length !== 2) return;
      this._startZoom = map.zoom; this._startDist = 100;
      this._centerPoint = this._startLatLng = this._pinchStartLatLng = new Point(0, 0);
      this._zooming = true; this._moved = false;
    },
  };
  map.touchZoom = touch;
  installPinchZoom(map, { DomEvent: { off() {}, preventDefault() {} } });
  return { map, touch, listeners };
}
const touches = distance => [new Point(-distance / 2, 0), new Point(distance / 2, 0)];
function pinch(interval, direction = 1, pause = 0, cancel = false, zoom = 12) {
  const state = createMap(zoom);
  state.touch._onTouchStart({ touches: touches(100) });
  for (let i = 1; i <= 12; i++) {
    advance(interval);
    state.touch._onTouchMove({ touches: touches(100 * 1.6 ** (direction * i / 12)) });
  }
  advance(16 + pause);
  const released = state.map.zoom;
  state.touch._onTouchEnd({ type: cancel ? (typeof cancel === 'string' ? cancel : 'touchcancel') : 'touchend', touches: [] });
  for (let i = 0; frames.size && i < 100; i++) advance(16);
  assert.equal(frames.size, 0, 'animation must finish');
  assert.equal(state.map.ended, 1, 'one gesture lifecycle must finish exactly once');
  return { released, final: state.map.zoom, drift: state.map.zoom - released };
}

try {
  const slow = pinch(65), fast = pinch(8), out = pinch(8, -1);
  assert.ok(Math.abs(fast.released - 12 - Math.log2(1.6) * 1.8) < 0.0001);
  assert.ok(fast.drift > slow.drift + 0.25);
  assert.ok(out.drift < -0.25);
  assert.ok(Math.abs(pinch(8, 1, 200).drift) < 0.0001, 'pause stops inertia');
  assert.ok(Math.abs(pinch(8, 1, 0, true).drift) < 0.0001, 'cancel stops inertia');
  assert.ok(Math.abs(pinch(8, 1, 0, 'pointercancel').drift) < 0.0001, 'pointer cancellation also stops inertia');
  assert.equal(pinch(8, 1, 0, false, 19.8).final, 20);
  assert.equal(pinch(8, -1, 0, false, 1.2).final, 1);

  const state = createMap();
  state.touch._onTouchStart({ touches: touches(100) });
  advance(20);
  state.touch._onTouchMove({ touches: touches(160) });
  advance(16);
  state.touch._onTouchEnd({ type: 'touchend', touches: touches(100).slice(0, 1) });
  assert.equal(state.map.ended, 0, 'wait for both fingers to lift');
  state.touch._onTouchEnd({ type: 'touchend', touches: [] });
  advance(60);
  state.touch._onTouchStart({ touches: touches(100).slice(0, 1) });
  const stopped = state.map.zoom;
  advance(1000);
  assert.equal(state.map.zoom, stopped, 'a new touch interrupts momentum immediately');
  assert.equal(frames.size, 0);
  assert.equal(state.map.ended, 1);
  console.log('PASS: pinch gain, speed-dependent inertia in both directions, pause/cancel, sequential finger release, interruption and zoom limits');
} finally {
  for (const [key, descriptor] of Object.entries(saved)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
}

const path = require('path');
const { makeLoader } = require('./ts_loader.cjs');
const assert = require('assert/strict');

function deepClone(v) {
  return JSON.parse(JSON.stringify(v));
}

function pt(latitude, longitude) {
  return { latitude, longitude };
}

function offsetMeters(p, northMeters = 0, eastMeters = 0) {
  const dLat = northMeters / 111111;
  const dLon = eastMeters / (111111 * Math.cos((p.latitude * Math.PI) / 180));
  return { latitude: p.latitude + dLat, longitude: p.longitude + dLon };
}

function buildLine(a, b, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    out.push({
      latitude: a.latitude + (b.latitude - a.latitude) * t,
      longitude: a.longitude + (b.longitude - a.longitude) * t,
    });
  }
  return out;
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function loadCore() {
  const loader = makeLoader();
  const srcDir = path.join(__dirname, '../src');
  const routeDraft = loader.load(path.join(srcDir, 'routeDraft.ts'));
  const gpsDraft = loader.load(path.join(srcDir, 'gpsDraft.ts'));
  const segmentEditing = loader.load(path.join(srcDir, 'segmentEditing.ts'));
  return { routeDraft, gpsDraft, segmentEditing };
}

function loadRouteCompletionWithStub(apiImpl) {
  const apiModule = { api: apiImpl };
  const srcDir = path.join(__dirname, '../src');
  const loader = makeLoader({
    './api': apiModule,
    [path.join(srcDir, 'api.ts')]: apiModule,
  });
  return loader.load(path.join(srcDir, 'routeCompletion.ts'));
}

// routeDraft threshold + format behavior
test('routeDraft thresholds and formatting near 20m are exact', () => {
  const { routeDraft } = loadCore();
  assert.equal(routeDraft.withinClosingDistance(5), true);
  assert.equal(routeDraft.withinClosingDistance(19), true);
  assert.equal(routeDraft.withinClosingDistance(20), true);
  assert.equal(routeDraft.withinClosingDistance(20.000001), true);
  assert.equal(routeDraft.withinClosingDistance(20.1), false);
  assert.equal(routeDraft.withinClosingDistance(21), false);
  assert.equal(routeDraft.withinClosingDistance(500), false);
  assert.equal(routeDraft.formatMeters(20.4), '20.4 m');
  assert.notEqual(routeDraft.formatMeters(20.4), '20 m');
});

test('rawGapToStart follows rawGps even when displayed endpoint moved', () => {
  const { routeDraft } = loadCore();
  const start = pt(48.8566, 2.3522);
  const displayedEnd = offsetMeters(start, 5, 0);
  const rawEnd = offsetMeters(start, 21, 0);
  const draft = {
    start,
    legs: [{ id: 'l1', source: 'gps', snapped: true, freedom: 'free', coordinates: [start, displayedEnd] }],
    rawGps: [{ ...rawEnd, timestamp: 1000, accuracy: 5 }],
  };
  assert(routeDraft.gapToStart(draft) < 20);
  assert(routeDraft.rawGapToStart(draft) > 20);
});

test('closed uses exact endpoint and usable rejects stationary/too-short', () => {
  const { routeDraft } = loadCore();
  const start = pt(48.8566, 2.3522);
  const mid = offsetMeters(start, 15, 0);
  const exact = { start, legs: [{ source: 'draw', freedom: 'free', coordinates: [start, mid, start] }] };
  const offBy2mm = offsetMeters(start, 0.002, 0);
  const nearNotExact = { start, legs: [{ source: 'draw', freedom: 'free', coordinates: [start, mid, offBy2mm] }] };
  const stationary = { start, legs: [{ source: 'draw', freedom: 'free', coordinates: [start, start] }] };
  const tooShort = { start, legs: [{ source: 'draw', freedom: 'free', coordinates: [start, offsetMeters(start, 5, 0), start] }] };
  assert.equal(routeDraft.closed(exact), true);
  assert.equal(routeDraft.closed(nearNotExact), false);
  assert.equal(routeDraft.usable(stationary), false);
  assert.equal(routeDraft.usable(tooShort), false);
});

// routeCompletion completeLoop + requestGpsMatch
test('completeLoop <=20m appends tiny return without routing call', async () => {
  let calls = 0;
  const routeCompletion = loadRouteCompletionWithStub(async () => {
    calls += 1;
    throw new Error('routing should not be called');
  });
  const { routeDraft } = loadCore();
  const start = pt(48.8566, 2.3522);
  const p1 = offsetMeters(start, 30, 0);
  const end = offsetMeters(start, 19, 0);
  const draft = {
    start,
    legs: [{ id: 'd1', source: 'draw', snapped: true, freedom: 'free', coordinates: [start, p1, end] }],
  };
  const out = await routeCompletion.completeLoop(draft);
  assert.equal(calls, 0);
  assert.equal(out.legs.length, 2);
  const ret = out.legs[1];
  assert.equal(ret.source, 'return');
  assert.equal(ret.freedom, 'caution');
  assert.deepEqual(ret.coordinates[0], end);
  assert.deepEqual(ret.coordinates.at(-1), start);
  assert.equal(routeDraft.stats(out).offLeashPct < 100, true);
});

test('completeLoop >20m calls pedestrian routing once and preserves input draft', async () => {
  const calls = [];
  const routeCompletion = loadRouteCompletionWithStub(async (pathArg, opts) => {
    calls.push({ pathArg, opts });
    const body = JSON.parse(opts.body);
    const from = { latitude: body.points[0][0], longitude: body.points[0][1] };
    const to = { latitude: body.points[1][0], longitude: body.points[1][1] };
    const mid = offsetMeters(from, -10, 6);
    return { coordinates: [[from.latitude, from.longitude], [mid.latitude, mid.longitude], [to.latitude, to.longitude]] };
  });
  const start = pt(48.8566, 2.3522);
  const p1 = offsetMeters(start, 50, 0);
  const end = offsetMeters(start, 45, 12);
  const draft = {
    start,
    legs: [
      { id: 'a', source: 'draw', snapped: true, freedom: 'free', coordinates: [start, p1, end] },
      { id: 'b', source: 'draw', snapped: true, freedom: 'leash', coordinates: [end, offsetMeters(end, 8, -2)] },
    ],
  };
  const snapshot = deepClone(draft);
  const out = await routeCompletion.completeLoop(draft);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].pathArg, '/routing/snap');
  const payload = JSON.parse(calls[0].opts.body);
  assert.equal(payload.alternatives, true);
  assert.equal(payload.profile, 'foot');
  assert.equal(out.legs.length, draft.legs.length + 1);
  assert.equal(out.legs.at(-1).source, 'return');
  assert.deepEqual(draft, snapshot);
  assert.equal(out.legs[0].freedom, 'free');
  assert.equal(out.legs[1].freedom, 'leash');
});

test('completeLoop rejects malformed/failing routing response and keeps draft unchanged', async () => {
  const start = pt(48.8566, 2.3522);
  const end = offsetMeters(start, 60, 0);
  const draft = { start, legs: [{ id: 'x', source: 'draw', snapped: true, freedom: 'free', coordinates: [start, end] }] };
  const snapshot = deepClone(draft);

  const malformed = loadRouteCompletionWithStub(async () => ({ coordinates: [[999, 0]] }));
  await assert.rejects(() => malformed.completeLoop(draft), /inutilisable|rejoint|calculé/i);
  assert.deepEqual(draft, snapshot);

  const failing = loadRouteCompletionWithStub(async () => {
    throw new Error('routing down');
  });
  await assert.rejects(() => failing.completeLoop(draft), /routing down/);
  assert.deepEqual(draft, snapshot);
});

test('completeLoop on already-closed draft returns same object and does not route', async () => {
  let calls = 0;
  const routeCompletion = loadRouteCompletionWithStub(async () => {
    calls += 1;
    return { coordinates: [] };
  });
  const start = pt(48.8566, 2.3522);
  const draft = { start, legs: [{ id: 'c', source: 'draw', snapped: true, freedom: 'free', coordinates: [start, offsetMeters(start, 20, 0), start] }] };
  const out = await routeCompletion.completeLoop(draft);
  assert.equal(out, draft);
  assert.equal(calls, 0);
});

test('completeLoop accepts large 20k return geometry without coordinate duplication', async () => {
  const routeCompletion = loadRouteCompletionWithStub(async (_pathArg, opts) => {
    const body = JSON.parse(opts.body);
    const from = { latitude: body.points[0][0], longitude: body.points[0][1] };
    const to = { latitude: body.points[1][0], longitude: body.points[1][1] };
    const line = buildLine(from, to, 20000);
    return { coordinates: line.map((p) => [p.latitude, p.longitude]) };
  });
  const start = pt(48.8566, 2.3522);
  const end = offsetMeters(start, 100, 0);
  const draft = { start, legs: [{ id: 'd', source: 'draw', snapped: true, freedom: 'free', coordinates: [start, end] }] };
  const beforeLen = draft.legs[0].coordinates.length;
  const out = await routeCompletion.completeLoop(draft);
  const ret = out.legs.at(-1);
  assert.equal(ret.coordinates.length, 20000);
  assert.deepEqual(ret.coordinates[0], end);
  assert.deepEqual(ret.coordinates.at(-1), start);
  assert.equal(draft.legs[0].coordinates.length, beforeLen);
});

test('requestGpsMatch sends only leg.gpsSamples payload and rejects malformed response', async () => {
  const calls = [];
  const routeCompletionOk = loadRouteCompletionWithStub(async (pathArg, opts) => {
    calls.push({ pathArg, body: JSON.parse(opts.body) });
    const b = JSON.parse(opts.body);
    return {
      coordinates: [
        [b.start_anchor[0], b.start_anchor[1]],
        [b.points[b.points.length - 1][0], b.points[b.points.length - 1][1]],
      ],
    };
  });
  const start = pt(48.8566, 2.3522);
  const s1 = { ...offsetMeters(start, 2, 0), timestamp: 1000, accuracy: 5 };
  const s2 = { ...offsetMeters(start, 8, 0), timestamp: 21000, accuracy: 6 };
  const leg = {
    id: 'g1',
    source: 'gps',
    snapped: false,
    freedom: 'free',
    coordinates: [start, offsetMeters(start, 1, 0)],
    gpsSamples: [s1, s2],
    rawGps: Array.from({ length: 50 }, (_, i) => ({ ...offsetMeters(start, i, 0), timestamp: i * 1000, accuracy: 10 })),
  };
  const out = await routeCompletionOk.requestGpsMatch(leg);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].pathArg, '/routing/match');
  assert.equal(calls[0].body.points.length, 2);
  assert.equal(calls[0].body.timestamps.length, 2);
  assert.equal(calls[0].body.accuracies.length, 2);
  assert.equal('rawGps' in calls[0].body, false);
  assert.equal(out.length >= 2, true);

  const routeCompletionBad = loadRouteCompletionWithStub(async () => ({ coordinates: [[120, 181], [120, 181]] }));
  await assert.rejects(() => routeCompletionBad.requestGpsMatch(leg), /invalide|rejoint/i);
});

// segmentEditing behavior
test('splitLeg projects onto edge, creates continuous parts, preserves freedom and distance', () => {
  const { routeDraft, segmentEditing } = loadCore();
  const start = pt(48.8566, 2.3522);
  const end = offsetMeters(start, 0, 100);
  const leg = { id: 's1', source: 'draw', snapped: true, freedom: 'free', coordinates: [start, end] };
  const draft = { start, legs: [leg], rawGps: [{ ...start, timestamp: 1, accuracy: 5 }] };
  const click = offsetMeters(start, 1, 50);
  const out = segmentEditing.splitLeg(draft, 0, click);
  assert.equal(out.legs.length, 2);
  const left = out.legs[0];
  const right = out.legs[1];
  assert.deepEqual(left.coordinates.at(-1), right.coordinates[0]);
  assert.equal(left.freedom, 'free');
  assert.equal(right.freedom, 'free');
  const originalDist = routeDraft.legDistance(leg);
  const splitDist = routeDraft.legDistance(left) + routeDraft.legDistance(right);
  assert(Math.abs(originalDist - splitDist) < 0.1);
  assert.equal(out.rawGps, draft.rawGps);
});

test('splitLeg rejects unsnapped, far-click, and near-endpoint splits', () => {
  const { segmentEditing } = loadCore();
  const start = pt(48.8566, 2.3522);
  const end = offsetMeters(start, 0, 80);

  const unsnapped = { start, legs: [{ id: 'u', source: 'draw', snapped: false, freedom: 'free', coordinates: [start, end] }] };
  assert.throws(() => segmentEditing.splitLeg(unsnapped, 0, offsetMeters(start, 0, 40)), /Ajustez d’abord/);

  const snapped = { start, legs: [{ id: 'v', source: 'draw', snapped: true, freedom: 'free', coordinates: [start, end] }] };
  assert.throws(() => segmentEditing.splitLeg(snapped, 0, offsetMeters(start, 120, 0)), /Touchez directement/);
  assert.throws(() => segmentEditing.splitLeg(snapped, 0, offsetMeters(start, 0, 1)), /au moins 3 m/);
});

test('splitLeg handles 20k coordinates and preserves generated return semantics', () => {
  const { segmentEditing } = loadCore();
  const start = pt(48.8566, 2.3522);
  const end = offsetMeters(start, 0, 300);
  const huge = buildLine(start, end, 20000);
  const draft = {
    start,
    rawGps: [{ ...start, timestamp: 1, accuracy: 4 }],
    legs: [{ id: 'r1', source: 'return', generated: true, snapped: true, freedom: 'caution', coordinates: huge }],
  };
  const click = offsetMeters(start, 0, 150);
  const out = segmentEditing.splitLeg(draft, 0, click);
  assert.equal(out.legs.length, 2);
  assert.equal(out.legs[0].generated, true);
  assert.equal(out.legs[1].generated, true);
  assert.equal(out.legs[0].source, 'return');
  assert.equal(out.legs[1].source, 'return');
  assert.equal(out.legs[0].freedom, 'caution');
  assert.equal(out.legs[1].freedom, 'caution');
  assert.equal(out.rawGps, draft.rawGps);
});

// gpsDraft windowing, replacement, continuity, immutability
test('gpsDraft acceptMatchedLeg updates sealed prefix only and preserves suffix/raw points', () => {
  const { gpsDraft } = loadCore();
  const start = pt(48.8566, 2.3522);
  const samples = [
    { ...start, timestamp: 1000, accuracy: 5 },
    { ...offsetMeters(start, 4, 0), timestamp: 3000, accuracy: 5 },
    { ...offsetMeters(start, 8, 0), timestamp: 5000, accuracy: 5 },
    { ...offsetMeters(start, 12, 0), timestamp: 7000, accuracy: 5 },
    { ...offsetMeters(start, 16, 0), timestamp: 9000, accuracy: 5 },
    { ...offsetMeters(start, 20, 0), timestamp: 11000, accuracy: 5 },
  ];

  let draft = { start: null, legs: [] };
  for (const s of samples.slice(0, 3)) draft = gpsDraft.addGpsSample(draft, s, 'free');
  draft = gpsDraft.sealGps(draft);
  for (const s of samples.slice(3)) draft = gpsDraft.addGpsSample(draft, s, 'free');

  assert.equal(draft.legs.length, 2);
  const firstId = draft.legs[0].id;
  const secondId = draft.legs[1].id;
  const secondGpsBefore = deepClone(draft.legs[1].gpsSamples);
  const rawBefore = deepClone(draft.rawGps);
  const snapshot = deepClone(draft);

  const matched = [draft.legs[0].coordinates[0], offsetMeters(draft.legs[0].coordinates[0], 10, 1)];
  const out = gpsDraft.acceptMatchedLeg(draft, firstId, matched);

  assert.equal(out.legs[0].id, firstId);
  assert.equal(out.legs[1].id, secondId);
  assert.deepEqual(out.legs[0].coordinates, matched);
  assert.equal(out.legs[0].snapped, true);
  assert.equal(out.legs[0].sealed, true);
  assert.deepEqual(out.legs[1].coordinates[0], matched.at(-1));
  assert.deepEqual(out.legs[1].gpsSamples, secondGpsBefore);
  assert.deepEqual(out.rawGps, rawBefore);
  assert.deepEqual(draft, snapshot);
  assert.deepEqual(out.legs[0].coordinates.at(-1), out.legs[1].coordinates[0]);
});

test('addGpsSample keeps all raw points across multiple loops and does not mutate snapshots', () => {
  const { gpsDraft } = loadCore();
  const start = pt(48.8566, 2.3522);
  const seq = [
    { ...start, timestamp: 1000, accuracy: 4 },
    { ...offsetMeters(start, 12, 0), timestamp: 3000, accuracy: 4 },
    { ...offsetMeters(start, 25, 0), timestamp: 5000, accuracy: 4 },
    { ...offsetMeters(start, 1, 0), timestamp: 7000, accuracy: 4 },
    { ...offsetMeters(start, 30, 0), timestamp: 9000, accuracy: 4 },
  ];
  let draft = { start: null, legs: [] };
  const snapshots = [];
  for (const s of seq) {
    snapshots.push({ ref: draft, clone: deepClone(draft) });
    draft = gpsDraft.addGpsSample(draft, s, 'free');
  }
  assert.equal(draft.rawGps.length, seq.length);
  assert.deepEqual(draft.rawGps.map((p) => p.timestamp), seq.map((p) => p.timestamp));
  for (let i = 0; i < snapshots.length; i++) {
    assert.deepEqual(snapshots[i].ref, snapshots[i].clone);
  }
});

test('restoreFinalGpsPosition adds <=20m connector and rejects far endpoint', () => {
  const { gpsDraft } = loadCore();
  const start = pt(48.8566, 2.3522);
  const end = offsetMeters(start, 40, 0);
  const nearRaw = { ...offsetMeters(end, 0, 15), timestamp: 12000, accuracy: 5 };
  const nearDraft = {
    start,
    rawGps: [nearRaw],
    legs: [{ id: 'n1', source: 'gps', snapped: true, sealed: true, freedom: 'free', coordinates: [start, end] }],
  };
  const nearOut = gpsDraft.restoreFinalGpsPosition(nearDraft);
  assert.equal(nearOut.legs.length, 2);
  assert.equal(nearOut.legs.at(-1).source, 'return');
  assert.equal(nearOut.legs.at(-1).generated, true);

  const farRaw = { ...offsetMeters(end, 0, 25), timestamp: 13000, accuracy: 5 };
  const farDraft = { ...nearDraft, rawGps: [farRaw] };
  assert.throws(() => gpsDraft.restoreFinalGpsPosition(farDraft), /trop loin du GPS/);
});

// route editing: ordered points, removal rebuild, insertion renumbering
function drawnLeg(id, from, to, freedom = 'free') {
  return { id, source: 'draw', snapped: true, freedom, coordinates: [from, to] };
}

function orderedDraft() {
  const start = pt(48.8566, 2.3522);
  const p2 = offsetMeters(start, 40, 0);
  const p3 = offsetMeters(start, 40, 60);
  const p4 = offsetMeters(start, 0, 60);
  return { start, p2, p3, p4 };
}

test('draftPoints numbers the ordered points and never lists the closing point twice', () => {
  const { routeDraft } = loadCore();
  const { start, p2, p3, p4 } = orderedDraft();
  const open = { start, legs: [drawnLeg('a', start, p2), drawnLeg('b', p2, p3, 'leash'), drawnLeg('c', p3, p4)] };
  const points = routeDraft.draftPoints(open);
  assert.equal(points.length, 4);
  assert.deepEqual(points.map((p) => p.index), [0, 1, 2, 3]);
  assert.equal(points[0].start, true);
  assert.deepEqual(points[2].coordinate, p3);
  assert.equal(routeDraft.closed(open), false);

  const loop = { ...open, legs: [...open.legs, { id: 'r', source: 'return', generated: true, snapped: true, freedom: 'caution', coordinates: [p4, start] }] };
  assert.equal(routeDraft.closed(loop), true);
  assert.equal(routeDraft.draftPoints(loop).length, 4);
  assert.deepEqual(routeDraft.draftPoints(loop).at(-1).coordinate, p4);
});

test('removeVertex rebuilds the segment in place, keeps the point order and the closure', () => {
  const { routeDraft } = loadCore();
  const { start, p2, p3, p4 } = orderedDraft();
  const legs = [drawnLeg('a', start, p2), drawnLeg('b', p2, p3, 'leash'), drawnLeg('c', p3, p4)];
  const loop = { start, legs: [...legs, { id: 'r', source: 'return', generated: true, snapped: true, freedom: 'caution', coordinates: [p4, start] }] };

  const next = routeDraft.removeVertex(loop, 2);
  assert.equal(next.legs.length, 3);
  const merged = next.legs[1];
  assert.equal(merged.source, 'draw');
  assert.equal(merged.snapped, false);
  assert.equal(merged.freedom, 'leash');
  assert.deepEqual(merged.coordinates, [p2, p4]);
  assert.notEqual(merged.id, 'b');
  assert.equal(routeDraft.closed(next), true);
  assert.deepEqual(routeDraft.draftPoints(next).map((p) => p.coordinate), [start, p2, p4]);
  assert.equal(loop.legs.length, 4);
  assert.deepEqual(loop.legs[1].coordinates, [p2, p3]);

  // Removing the junction before the generated return rebuilds one closed segment.
  const beforeReturn = routeDraft.removeVertex(loop, 3);
  assert.equal(beforeReturn.legs.length, 3);
  assert.equal(routeDraft.closed(beforeReturn), true);
  assert.deepEqual(beforeReturn.legs.at(-1).coordinates.at(-1), start);
  assert.deepEqual(routeDraft.draftPoints(beforeReturn).map((p) => p.coordinate), [start, p2, p3]);
});

test('removeVertex refuses the start point and joins GPS runs without rerouting', () => {
  const { routeDraft } = loadCore();
  const start = pt(48.8566, 2.3522);
  const g1 = offsetMeters(start, 20, 0);
  const g2 = offsetMeters(start, 40, 0);
  const g3 = offsetMeters(start, 60, 0);
  const raw = [{ ...start, timestamp: 1, accuracy: 5 }];
  const draft = {
    start, rawGps: raw,
    legs: [drawnLeg('d', start, g1),
      { id: 'g1', source: 'gps', freedom: 'free', snapped: true, sealed: true, coordinates: [g1, g2] },
      { id: 'g2', source: 'gps', freedom: 'free', snapped: true, sealed: true, coordinates: [g2, g3] }],
  };
  assert.throws(() => routeDraft.removeVertex(draft, 0), /départ/);
  assert.equal(routeDraft.draftPoints(draft)[2].internal, true);

  const joined = routeDraft.removeVertex(draft, 2);
  assert.equal(joined.legs.length, 2);
  assert.equal(joined.legs[1].source, 'gps');
  assert.equal(joined.legs[1].snapped, true);
  assert.deepEqual(joined.legs[1].coordinates, [g1, g2, g3]);
  assert.deepEqual(joined.rawGps, raw);

  // The open end has no following point: only the extra segment is dropped.
  const dropped = routeDraft.removeVertex(draft, 3);
  assert.deepEqual(dropped.legs.map((l) => l.id), ['d', 'g1']);
  assert.equal(routeDraft.draftPoints(dropped).length, 3);
  assert.deepEqual(draft.legs.map((l) => l.id), ['d', 'g1', 'g2']);
});

test('adding a point on a segment inserts it in order and renumbers the following points', () => {
  const { routeDraft, segmentEditing } = loadCore();
  const { start, p2, p3, p4 } = orderedDraft();
  const draft = { start, legs: [drawnLeg('a', start, p2), drawnLeg('b', p2, p3), drawnLeg('c', p3, p4)] };
  assert.deepEqual(routeDraft.draftPoints(draft).map((p) => p.coordinate), [start, p2, p3, p4]);

  // Touch the middle of the segment linking point 2 and point 3.
  const click = offsetMeters(start, 40, 30);
  const out = segmentEditing.splitLeg(draft, 1, click);
  const points = routeDraft.draftPoints(out);
  assert.equal(points.length, 5);
  assert.equal(routeDraft.meters(points[2].coordinate, click) < 1, true);
  assert.deepEqual(points[3].coordinate, p3);
  assert.deepEqual(points[4].coordinate, p4);
  assert.equal(out.legs.length, 4);
  assert.deepEqual(out.legs[1].coordinates.at(-1), out.legs[2].coordinates[0]);
  assert.equal(draft.legs.length, 3);
});

test('segment metadata survives editing and shared markers serialize separately from variants', () => {
  const { routeDraft, segmentEditing } = loadCore();
  const metadata = makeLoader().load(path.join(__dirname, '../src/create/routeMetadata.ts'));
  const start = { latitude: 48.85, longitude: 2.35 };
  const middle = offsetMeters(start, 80, 0), end = offsetMeters(start, 80, 80);
  const note = { id: 'n', kind: 'hazard', type: 'path_closed', coordinate: middle, description: 'Barrière' };
  const draft = { start, legs: [
    { id: 'a', source: 'draw', freedom: 'free', snapped: true, coordinates: [start, middle], features: ['shade'], dangers: ['cars'], notes: 'Ombre' },
    { id: 'b', source: 'draw', freedom: 'leash', snapped: true, coordinates: [middle, end], interests: ['water'], notes: 'Eau' },
    { id: 'c', source: 'draw', freedom: 'free', snapped: true, coordinates: [end, start] },
  ] };
  const split = segmentEditing.splitLeg(draft, 0, offsetMeters(start, 40, 0));
  assert.deepEqual(split.legs[1].features, ['shade']);
  const merged = routeDraft.removeVertex(draft, 1);
  assert.deepEqual(merged.legs[0].features, ['shade']);
  assert.deepEqual(merged.legs[0].interests, ['water']);
  assert.equal(merged.legs[0].notes, 'Ombre\nEau');
  const moved = segmentEditing.moveVertex(draft, 1, offsetMeters(start, 100, 10));
  assert.deepEqual(moved.legs[0].coordinates.at(-1), moved.legs[1].coordinates[0]);
  assert.equal(moved.legs[0].snapped, false);
  assert.equal(routeDraft.closed(moved), true);
  assert.deepEqual(draft.legs[0].coordinates.at(-1), middle, 'editing a copy cannot mutate route A');
  assert.throws(() => segmentEditing.moveVertex(draft, 0, middle));
  const payload = metadata.serializeVariant({ name: 'B', draft: moved, durationMin: 24 });
  assert.equal(payload.name, 'B');
  assert.equal(payload.duration_min, 24);
  assert.equal(payload.hazards, undefined);
  assert.equal(metadata.serializeNotes([note]).hazards[0].description, 'Barrière');
  assert.deepEqual(payload.segments[0].dangers, ['cars']);
});

test('off-road routing asks for confirmation, supports following paths instead and preserves cancellation', async () => {
  let calls = 0, confirmations = 0;
  const rc = loadRouteCompletionWithStub(async () => { calls++; throw new Error('Un point est à plus de 20 m d’un chemin connu.'); });
  const start = pt(48.85, 2.35), end = offsetMeters(start, 150, 50);
  const leg = { id: 'field', source: 'draw', freedom: 'leash', snapped: false, coordinates: [start, end] };
  const direct = await rc.resolvePath(leg, async request => { confirmations++; assert.match(request.reason, /20 m/); return 'direct'; });
  assert.equal(calls, 1); assert.equal(confirmations, 1);
  assert.equal(direct.offPath, true); assert.equal(direct.snapped, false);
  assert.equal(direct.freedom, 'leash');
  assert.deepEqual(leg.coordinates, [start, end]);
  await assert.rejects(rc.resolvePath(leg, async () => 'cancel', true), /annulé/);
  assert.equal(calls, 1, 'explicit free mode can be cancelled without calling the router');
  const routed = loadRouteCompletionWithStub(async (_path, opts) => ({ coordinates: JSON.parse(opts.body).points }));
  const follow = await routed.resolvePath(leg, async () => 'paths', true);
  assert.equal(follow.snapped, true); assert.equal(follow.offPath, false);
});

test('closing away from known roads accepts a confirmed free return and never reroutes it later', async () => {
  let calls = 0;
  const rc = loadRouteCompletionWithStub(async () => { calls++; throw new Error('Point loin du chemin'); });
  const { routeDraft, segmentEditing } = loadCore();
  const start = pt(48.85, 2.35), end = offsetMeters(start, 150, 50);
  const leg = { id: 'field', source: 'draw', freedom: 'free', offPath: true, snapped: false, coordinates: [start, end] };
  const draft = { start, legs: [leg] };
  const resolve = candidate => rc.resolvePath(candidate, async () => 'direct');
  const loop = await rc.completeLoop(draft, resolve);
  assert.equal(routeDraft.closed(loop), true);
  assert.equal(loop.legs.at(-1).offPath, true);
  assert.equal(loop.legs.at(-1).freedom, 'free');
  assert.equal(calls, 1);
  await rc.snapDraft(loop, resolve);
  assert.equal(calls, 1, 'confirmed free segments survive preparation without another road lookup');
  const split = segmentEditing.splitLeg(loop, 0, offsetMeters(start, 75, 25));
  assert.equal(split.legs[0].offPath, true); assert.equal(split.legs[1].offPath, true);
  const meta = makeLoader().load(path.join(__dirname, '../src/create/routeMetadata.ts'));
  assert.equal(meta.serializeVariant({ name: 'B', draft: split }).segments.every(s => s.off_path), true);
});

test('accepting raw GPS off-road preserves the recorded geometry rather than connecting its endpoints', () => {
  const rc = loadRouteCompletionWithStub(async () => { throw new Error('must not route'); });
  const start = pt(48.85, 2.35), bend = offsetMeters(start, 80, 0), end = offsetMeters(start, 80, 80);
  const leg = { source: 'gps', freedom: 'caution', coordinates: [start, bend, end] };
  const saved = rc.acceptOffPath(leg);
  assert.deepEqual(saved.coordinates, [start, bend, end]);
  assert.equal(saved.offPath, true); assert.equal(saved.sealed, true);
});

test('navigation requires the departure, identifies corners, recovers from an excursion and finishes the loop once', () => {
  const { buildNavigation, initialProgress, updateProgress } = makeLoader().load(path.join(__dirname, '../src/navigation.ts'));
  const start = pt(48.85, 2.35);
  const point = (north, east) => offsetMeters(start, north, east);
  const route = buildNavigation([{ coordinates: [start, point(100, 0), point(100, 100), point(0, 100), start] }]);
  assert.deepEqual(route.turns.map(turn => turn.side), ['right', 'right', 'right']);
  const update = (state, fix) => updateProgress(route, state, fix, 5);
  assert.equal(update(initialProgress, point(60, 0)).started, false);
  let state = update(initialProgress, start);
  assert.equal(state.started, true);
  assert.equal(update(state, start).arrived, false);
  state = update(state, point(45, 0));
  const off = update(state, point(45, -80));
  assert.equal(off.offRoute, true);
  assert.equal(off.along, state.along);
  state = update(off, point(60, 0));
  assert.equal(state.offRoute, false);
  for (const fix of [point(100, 0), point(100, 60), point(100, 100), point(40, 100), point(0, 100), point(0, 45), start]) state = update(state, fix);
  assert.equal(state.arrived, true);
  assert.equal(state.along, route.total);
});

test('duration follows distance and terrain; legacy notes do not duplicate shared markers', () => {
  const { estimateWalkMinutes, mergeWalkNotes } = makeLoader().load(path.join(__dirname, '../src/walkDetails.ts'));
  assert.equal(estimateWalkMinutes(5, 'city', 'easy'), 60);
  assert.equal(estimateWalkMinutes(10, 'city', 'easy'), 120);
  assert.ok(estimateWalkMinutes(5, 'mountain', 'easy') > 60);
  assert.ok(estimateWalkMinutes(5, 'city', 'sporty') > 60);
  const shared = { id: 'p1', type: 'water', lat: 48, lng: 2, description: 'Fontaine' };
  const legacy = { ...shared, id: 'old' };
  const unique = { ...legacy, lng: 3 };
  assert.deepEqual(mergeWalkNotes([shared], [legacy, unique]), [shared, unique]);
});

async function run() {
  let passed = 0;
  const failures = [];
  for (const t of tests) {
    try {
      await t.fn();
      passed += 1;
      console.log(`PASS: ${t.name}`);
    } catch (err) {
      failures.push({ name: t.name, error: err && err.stack ? err.stack : String(err) });
      console.log(`FAIL: ${t.name}`);
      console.log(err && err.stack ? err.stack : String(err));
    }
  }
  console.log(`\nRESULT: ${passed}/${tests.length} passed`);
  if (failures.length) {
    process.exitCode = 1;
  }
}

run();

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');

let ts;
try {
  ts = require('typescript');
} catch {
  ts = require(path.join(__dirname, '../node_modules/typescript'));
}

function deepClone(v) {
  return JSON.parse(JSON.stringify(v));
}

function makeLoader(stubs = {}) {
  const cache = new Map();

  function resolveTs(request, fromDir) {
    const isRelative = request.startsWith('.') || request.startsWith('/');
    if (!isRelative) return null;
    const base = path.resolve(fromDir, request);
    const candidates = [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      `${base}.js`,
      path.join(base, 'index.ts'),
      path.join(base, 'index.tsx'),
      path.join(base, 'index.js'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    }
    return null;
  }

  function evaluate(filePath) {
    if (cache.has(filePath)) return cache.get(filePath).exports;

    const ext = path.extname(filePath);
    if (ext !== '.ts' && ext !== '.tsx') {
      const mod = require(filePath);
      cache.set(filePath, { exports: mod });
      return mod;
    }

    const source = fs.readFileSync(filePath, 'utf8');
    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
        jsx: ts.JsxEmit.React,
      },
      fileName: filePath,
      reportDiagnostics: false,
    }).outputText;

    const module = { exports: {} };
    cache.set(filePath, module);

    const dirname = path.dirname(filePath);
    const localRequire = (request) => {
      if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
      const resolved = resolveTs(request, dirname);
      if (resolved && Object.prototype.hasOwnProperty.call(stubs, resolved)) return stubs[resolved];
      if (resolved) return evaluate(resolved);
      return require(request);
    };

    const wrapper = `(function (exports, require, module, __filename, __dirname) { ${transpiled}\n})`;
    const compiled = vm.runInThisContext(wrapper, { filename: filePath });
    compiled(module.exports, localRequire, module, filePath, dirname);
    return module.exports;
  }

  return {
    load: (absoluteFilePath) => evaluate(absoluteFilePath),
  };
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

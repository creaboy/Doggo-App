import { useRef, useState } from 'react';
import { api } from './api';
import type { LatLng } from './DoggoMap';
import { addPoint, closed, Draft, emptyDraft, Freedom, legDistance, legId, meters, rawGapToStart, usable, withinClosingDistance } from './routeDraft';
import { completeLoop, requestPath, snapDraft } from './routeCompletion';
import { useRouteRecorder } from './useRouteRecorder';
import { useGpsSnapping } from './useGpsSnapping';
import { addGpsSample, restoreFinalGpsPosition } from './gpsDraft';
import { splitLeg } from './segmentEditing';

export function useWalkCreation() {
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const current = useRef(draft);
  const history = useRef<Draft[]>([]);
  const [mode, setMode] = useState<'draw' | 'record'>('draw');
  const [freedom, setFreedom] = useState<Freedom>('free');
  const [selection, setSelection] = useState<{ index: number; point: LatLng | null } | null>(null);
  const [wpSelection, setWpSelection] = useState<number | null>(null);
  const [offRoute, setOffRoute] = useState<{ legId: string; straight: LatLng[]; snapped: LatLng[] | null } | null>(null);
  const [preview, setPreview] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const working = useRef(false);
  const commit = (value: Draft, undoable = false) => {
    if (undoable) history.current.push(current.current);
    current.current = value; setDraft(value);
  };
  const recorder = useRouteRecorder(p => commit(addGpsSample(current.current, p, freedom)), setError);
  const gps = useGpsSnapping(recorder.recording, () => current.current, commit);
  const locked = !!busy || gps.busy || recorder.recording || recorder.starting;
  const run = async (label: string, job: () => Promise<void>) => {
    if (working.current) { setNotice('Patientez : le calcul en cours doit se terminer.'); return; }
    working.current = true; setBusy(label); setError(''); setNotice('');
    try { await job(); } catch (e: any) { setError(e.message || 'Impossible de terminer. Votre tracé est conservé.'); }
    finally { working.current = false; setBusy(''); }
  };
  const tap = (point: LatLng) => {
    if (mode !== 'draw' || locked || gps.busy || working.current || preview || finishOpen) return;
    // Toucher (ou retoucher) le point de départ ferme la boucle.
    if (current.current.start && current.current.legs.length && meters(point, current.current.start) <= 30) { void closeManual(); return; }
    const next = addPoint(current.current, point, freedom, 'draw');
    if (next === current.current) return;
    commit(next, true); setSelection(null); setError(''); setNotice('');
    if (!next.legs.length) return;
    const leg = next.legs.at(-1)!;
    const straight = [leg.coordinates[0], leg.coordinates[leg.coordinates.length - 1]];
    const straightLen = meters(straight[0], straight[1]);
    void run('Ajustement du nouveau segment…', async () => {
      let snapped: LatLng[] | null = null;
      try { snapped = await requestPath(leg.coordinates); } catch { snapped = null; }
      const snappedLen = snapped ? legDistance({ coordinates: snapped, freedom: leg.freedom }) : Infinity;
      if (snapped && straightLen > 5 && snappedLen / straightLen <= 1.3) {
        commit({ ...current.current, legs: current.current.legs.map(l => l.id === leg.id ? { ...l, coordinates: snapped!, snapped: true } : l) });
        setNotice('Segment ajusté aux chemins · touchez-le pour modifier ses règles');
      } else {
        setOffRoute({ legId: leg.id!, straight, snapped });
      }
    });
  };
  const acceptOffRoute = () => {
    if (!offRoute) return;
    const { legId, straight } = offRoute;
    commit({ ...current.current, legs: current.current.legs.map(l => l.id === legId ? { ...l, coordinates: straight, snapped: true, offRoute: true, generated: true } : l) }, true);
    setOffRoute(null); setNotice('Trajet hors-chemin conservé (affiché en pointillés).'); setError('');
  };
  const alignToPaths = () => {
    if (!offRoute) return;
    const { legId, snapped } = offRoute;
    setOffRoute(null);
    if (snapped) {
      commit({ ...current.current, legs: current.current.legs.map(l => l.id === legId ? { ...l, coordinates: snapped, snapped: true } : l) }, true);
      setNotice('Trajet aligné sur les chemins.');
    } else {
      void run('Alignement sur les chemins…', async () => {
        const leg = current.current.legs.find(l => l.id === legId); if (!leg) return;
        const coordinates = await requestPath([leg.coordinates[0], leg.coordinates[leg.coordinates.length - 1]]);
        commit({ ...current.current, legs: current.current.legs.map(l => l.id === legId ? { ...l, coordinates, snapped: true } : l) });
      });
    }
  };
  const undo = () => {
    if (locked || gps.busy || working.current) return;
    const previous = history.current.pop();
    if (preview && (!previous || !closed(previous))) {
      if (previous) history.current.push(previous);
      setError('Cette action rouvrirait la boucle. Revenez au tracé pour continuer à le modifier.'); return;
    }
    commit(previous || { ...current.current, legs: current.current.legs.slice(0, -1) });
    setSelection(null); setNotice(''); setError('');
  };
  const clear = () => {
    if (locked || gps.busy || working.current) return;
    recorder.reset(); gps.cancel(); history.current = []; commit(emptyDraft()); setSelection(null);
    setError(''); setNotice(''); setPreview(false); setFinishOpen(false);
  };
  const closeManual = () => run('Fermeture de la boucle…', async () => {
    if (!usable(current.current)) throw new Error('Ajoutez un véritable trajet avant de fermer la boucle (20 m minimum).');
    await gps.flush();
    const prepared = await snapDraft(current.current);
    commit(await completeLoop(prepared), true); setNotice('Boucle terminée · départ et arrivée identiques');
  });
  const snap = () => run('Ajustement aux chemins piétons…', async () => {
    if (!current.current.legs.length) throw new Error('Ajoutez au moins deux points.');
    await gps.flush();
    commit(await snapDraft(current.current), true); setNotice('Tracé ajusté aux chemins piétons');
  });
  const start = () => {
    if (working.current) return;
    // A suggested return is not a GPS path already walked. Resume from the real trace,
    // retaining all non-generated edits/splits instead of recording from a virtual finish.
    const saved = current.current;
    if (saved.rawGps?.length) {
      let end = saved.legs.length;
      while (end && saved.legs[end - 1].generated && saved.legs[end - 1].source === 'return') end--;
      if (end !== saved.legs.length) commit({ ...saved, legs: saved.legs.slice(0, end) }, true);
    }
    setError(''); setNotice(''); setPreview(false); void recorder.start();
  };
  const stop = () => {
    recorder.stop(); setError('');
    const saved = current.current;
    if (!usable(saved)) { setError('Pas assez de déplacement GPS exploitable. Continuez l’enregistrement ; vos points sont conservés.'); return; }
    if (!withinClosingDistance(rawGapToStart(saved))) { setFinishOpen(true); return; }
    void run('Fermeture du dernier petit écart…', async () => {
      await gps.flush();
      commit(await completeLoop(restoreFinalGpsPosition(current.current)), true); setNotice('Boucle terminée'); setSelection(null); setPreview(true);
    });
  };
  const continueRecording = () => { if (working.current) return; setFinishOpen(false); setError(''); start(); };
  const finishReturn = () => run('Calcul du retour piéton…', async () => {
    await gps.flush();
    commit(await completeLoop(restoreFinalGpsPosition(current.current)), true);
    setFinishOpen(false); setNotice('Boucle terminée · retour ajouté à vérifier'); setSelection(null); setPreview(true);
  });
  const showPreview = () => run('Préparation de l’aperçu…', async () => {
    if (!usable(current.current)) throw new Error('Le parcours est trop court pour être publié.');
    if (!closed(current.current)) throw new Error('Fermez la boucle avant de consulter l’aperçu et publier.');
    await gps.flush();
    const final = await snapDraft(current.current);
    if (!closed(final)) throw new Error('La boucle doit rejoindre exactement son point de départ.');
    commit(final); setSelection(null); setPreview(true);
  });
  const updateFreedom = (index: number, value: Freedom) => {
    if (working.current || gps.busy) return;
    commit({ ...current.current, legs: current.current.legs.map((leg, i) => i === index ? { ...leg, freedom: value } : leg) }, !recorder.recording);
  };
  const selectSegment = (index: number, point?: LatLng) => { setSelection({ index, point: point || null }); setError(''); };
  const splitSelected = () => {
    if (!selection?.point || working.current || gps.busy || recorder.recording || recorder.starting) return;
    try { commit(splitLeg(current.current, selection.index, selection.point), true); setSelection(null); setNotice('Segment divisé : chaque portion peut maintenant avoir sa propre règle.'); setError(''); }
    catch (e: any) { setError(e.message); }
  };
  const removeWaypoint = (k: number) => {
    if (locked || gps.busy || working.current || recorder.recording || recorder.starting || preview) return;
    const d = current.current;
    const a = k - 2, b = k - 1; // segments avant/après le point k
    if (k < 2 || a < 0 || b > d.legs.length - 1) return;
    if (closed(d) && b === d.legs.length - 1) { setError('Impossible de supprimer le point qui referme la boucle.'); return; }
    const prev = d.legs[a], next = d.legs[b];
    const merged = { id: legId(), coordinates: [prev.coordinates[0], next.coordinates[next.coordinates.length - 1]], freedom: prev.freedom, source: 'draw' as const, snapped: false };
    commit({ ...d, legs: [...d.legs.slice(0, a), merged, ...d.legs.slice(b + 1)] }, true);
    setWpSelection(null); setSelection(null); setError('');
    void run('Recalcul de l’itinéraire…', async () => {
      const coordinates = await requestPath(merged.coordinates);
      commit({ ...current.current, legs: current.current.legs.map(l => l.id === merged.id ? { ...l, coordinates, snapped: true } : l) });
      setNotice(`Point ${k} supprimé · itinéraire recalculé`);
    });
  };
  const canRemoveWaypoint = (k: number) => {
    const d = current.current;
    if (k < 2) return false;
    const b = k - 1;
    if (b > d.legs.length - 1) return false;
    if (closed(d) && b === d.legs.length - 1) return false;
    return true;
  };
  const publish = async (details: object) => {
    if (working.current || gps.busy || !preview || recorder.recording || recorder.starting || !closed(current.current) || !usable(current.current) || current.current.legs.some(l => !l.snapped)) throw new Error('Vérifiez une boucle entièrement ajustée avant de publier.');
    working.current = true; setBusy('Publication…'); setError('');
    try {
      return await api('/walks', { method: 'POST', body: JSON.stringify({ ...details,
        segments: current.current.legs.map(s => ({ freedom: s.freedom, coordinates: s.coordinates.map(p => [p.latitude, p.longitude]) })),
        features: [], pois: [], hazards: [],
      }) });
    } finally { working.current = false; setBusy(''); }
  };
  const canUndoInPreview = !!history.current.length && closed(history.current.at(-1)!);
  return { draft, mode, setMode, freedom, setFreedom, preview, setPreview, gps, selection, selectSegment, setSelection, splitSelected, canUndoInPreview,
    wpSelection, setWpSelection, removeWaypoint, canRemoveWaypoint,
    offRoute, acceptOffRoute, alignToPaths,
    finishOpen, error, setError, notice, busy, locked, recorder, tap, undo, clear, closeManual, snap,
    start, stop, continueRecording, finishReturn, showPreview, updateFreedom, publish };
}
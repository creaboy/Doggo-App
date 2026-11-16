import { useRef, useState } from 'react';
import { api } from './api';
import type { LatLng } from './DoggoMap';
import { addPoint, closed, Draft, emptyDraft, Freedom, meters, rawGapToStart, removeVertex, usable, withinClosingDistance } from './routeDraft';
import type { DraftSelection } from './create/selection';
import { completeLoop, requestPath, snapDraft } from './routeCompletion';
import { useRouteRecorder } from './useRouteRecorder';
import { useGpsSnapping } from './useGpsSnapping';
import { addGpsSample, restoreFinalGpsPosition } from './gpsDraft';
import { splitLeg, moveVertex } from './segmentEditing';
import { serializeNotes, serializeSegments, serializeVariant } from './create/routeMetadata';
import type { RouteNote, SegmentDetails, RouteVariant } from './create/routeMetadata';

export function useWalkCreation() {
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const current = useRef(draft);
  const history = useRef<Draft[]>([]);
  const [mode, setMode] = useState<'draw' | 'record'>('draw');
  const [freedom, setFreedom] = useState<Freedom>('free');
  const [selection, setSelection] = useState<DraftSelection | null>(null);
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
    if (working.current) { setNotice('Patientez : le calcul en cours doit se terminer.'); return false; }
    working.current = true; setBusy(label); setError(''); setNotice('');
    try { await job(); return true; } catch (e: any) { setError(e.message || 'Impossible de terminer. Votre tracé est conservé.'); return false; }
    finally { working.current = false; setBusy(''); }
  };
  const tap = (point: LatLng) => {
    if (mode !== 'draw' || locked || gps.busy || working.current || preview || finishOpen) return;
    const next = addPoint(current.current, point, freedom, 'draw');
    if (next === current.current) return;
    commit(next, true); setSelection(null); setError(''); setNotice('');
    if (!next.legs.length) return;
    const leg = next.legs.at(-1)!;
    void run('Ajustement du nouveau segment…', async () => {
      const coordinates = await requestPath(leg.coordinates);
      commit({ ...current.current, legs: current.current.legs.map(l => l.id === leg.id ? { ...l, coordinates, snapped: true } : l) });
      setNotice('Segment ajusté aux chemins · touchez-le pour modifier ses règles');
    });
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
      commit(await completeLoop(restoreFinalGpsPosition(current.current)), true); setNotice('Boucle terminée · passez aux retouches'); setSelection(null);
    });
  };
  const continueRecording = () => { if (working.current) return; setFinishOpen(false); setError(''); start(); };
  const finishReturn = () => run('Calcul du retour piéton…', async () => {
    await gps.flush();
    commit(await completeLoop(restoreFinalGpsPosition(current.current)), true);
    setFinishOpen(false); setNotice('Boucle terminée · retour ajouté à vérifier'); setSelection(null);
  });
  const showPreview = () => run('Vérification de la boucle…', async () => {
    if (!usable(current.current)) throw new Error('Le parcours est trop court pour être publié.');
    if (!closed(current.current)) throw new Error('Rejoignez le départ pour fermer la boucle avant de passer à l’étape suivante.');
    await gps.flush();
    const final = await snapDraft(current.current);
    if (!closed(final)) throw new Error('La boucle doit rejoindre exactement son point de départ.');
    commit(final); setSelection(null); setPreview(true);
  });
  const updateFreedom = (index: number, value: Freedom) => {
    if (working.current || gps.busy) return;
    commit({ ...current.current, legs: current.current.legs.map((leg, i) => i === index ? { ...leg, freedom: value } : leg) }, !recorder.recording);
  };
  const updateDetails = (index: number, details: SegmentDetails) => {
    if (locked || working.current) return;
    commit({ ...current.current, legs: current.current.legs.map((leg, i) => i === index ? { ...leg, ...details } : leg) }, true);
  };
  const saveAnnotation = (note: RouteNote) => {
    if (working.current) return;
    const annotations = current.current.annotations || [];
    commit({ ...current.current, annotations: [...annotations.filter(n => n.id !== note.id), note] }, !recorder.recording);
  };
  const removeAnnotation = (id: string) => {
    if (working.current) return;
    commit({ ...current.current, annotations: (current.current.annotations || []).filter(n => n.id !== id) }, !recorder.recording);
  };
  const replaceDraft = (next: Draft) => {
    if (locked || working.current) return;
    gps.cancel(); recorder.reset(); history.current = []; commit(next); setSelection(null); setPreview(false); setError(''); setNotice('');
  };
  const markSegment = () => {
    const legs = current.current.legs;
    if (!recorder.recording || !legs.length) return;
    commit({ ...current.current, legs: legs.map((l, i) => i === legs.length - 1 ? { ...l, sealed: true } : l) });
    setNotice('Repère posé · les prochains pas formeront un nouveau segment');
  };
  const selectSegment = (index: number, point?: LatLng) => { setSelection({ kind: 'segment', index, point: point || null }); setError(''); setNotice(''); };
  const selectPoint = (index: number) => { setSelection({ kind: 'point', index }); setError(''); setNotice(''); };
  // Removing a point stays where the user is: no camera move, the segment is rebuilt in place.
  const removePoint = () => {
    if (selection?.kind !== 'point' || locked || gps.busy || working.current) return;
    const index = selection.index;
    void run('Suppression du point…', async () => {
      let next = removeVertex(current.current, index);
      const rebuilt = next.legs[index - 1];
      // A hand drawn segment is re-routed between its new neighbours; nothing is committed if routing fails.
      if (rebuilt && rebuilt.source === 'draw' && !rebuilt.snapped) {
        const coordinates = await requestPath(rebuilt.coordinates);
        next = { ...next, legs: next.legs.map(l => l.id === rebuilt.id ? { ...l, coordinates, snapped: true } : l) };
      }
      commit(next, true);
      setSelection(null);
      setNotice(`Point ${index + 1} supprimé · segment recréé`);
    });
  };
  const splitSelected = () => {
    if (selection?.kind !== 'segment' || !selection.point || working.current || gps.busy || recorder.recording || recorder.starting) return;
    try { commit(splitLeg(current.current, selection.index, selection.point), true); setSelection(null); setNotice('Segment divisé : chaque portion peut maintenant avoir sa propre règle.'); setError(''); }
    catch (e: any) { setError(e.message); }
  };
  const movePoint = (point: LatLng) => {
    if (selection?.kind !== 'point' || locked || working.current) return;
    const index = selection.index;
    return run('Recalcul des portions voisines…', async () => {
      const next = await snapDraft(moveVertex(current.current, index, point));
      commit(next, true); setSelection(null); setNotice('Point déplacé · les deux portions suivent les chemins');
    });
  };
  const publish = async (details: object, variants?: RouteVariant[]) => {
    const routes = variants || [{ name: 'A', draft: current.current }];
    if (working.current || gps.busy || !preview || recorder.recording || recorder.starting || routes.some(v => !closed(v.draft) || !usable(v.draft) || v.draft.legs.some(l => !l.snapped))) throw new Error('Chaque itinéraire doit former une boucle entièrement ajustée avant publication.');
    const main = routes[0].draft;
    if (routes.some(v => meters(main.start!, v.draft.start!) > .01)) throw new Error('Tous les itinéraires doivent partager le départ de A. Corrigez le tracé de la variante concernée.');
    working.current = true; setBusy('Publication…'); setError('');
    try {
      return await api('/walks', { method: 'POST', body: JSON.stringify({ ...details,
        segments: serializeSegments(main.legs),
        features: [...new Set(main.legs.flatMap(s => s.features || []))], ...serializeNotes(main.annotations),
        variants: routes.slice(1).map(serializeVariant),
      }) });
    } finally { working.current = false; setBusy(''); }
  };
  return { draft, mode, setMode, freedom, setFreedom, preview, setPreview, gps, selection, selectSegment, selectPoint, removePoint, setSelection, splitSelected,
    finishOpen, error, setError, notice, busy, locked, recorder, tap, undo, clear, closeManual, snap,
    start, stop, continueRecording, finishReturn, showPreview, updateFreedom, updateDetails, saveAnnotation, removeAnnotation, replaceDraft, markSegment, movePoint, publish };
}

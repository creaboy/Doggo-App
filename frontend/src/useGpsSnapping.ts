import { useEffect, useRef, useState } from 'react';
import { Draft } from './routeDraft';
import { acceptMatchedLeg, sealGps } from './gpsDraft';
import { requestGpsMatch } from './routeCompletion';

export const GPS_SNAP_INTERVAL_MS = 20000;
export function useGpsSnapping(recording: boolean, getDraft: () => Draft, commit: (d: Draft) => void) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Ajustement GPS toutes les 20 secondes');
  const [error, setError] = useState('');
  const current = useRef({ getDraft, commit }); current.current = { getDraft, commit };
  const inFlight = useRef<Promise<void> | null>(null);
  const epoch = useRef(0);
  const flush = async (): Promise<void> => {
    if (inFlight.current) { await inFlight.current; return flush(); }
    const token = epoch.current;
    current.current.commit(sealGps(current.current.getDraft()));
    if (!current.current.getDraft().legs.some(l => l.source === 'gps' && !l.snapped && l.sealed)) return;
    setBusy(true); setError(''); setMessage('Ajustement des nouveaux points GPS…');
    const work = (async () => {
      let leg = current.current.getDraft().legs.find(l => l.source === 'gps' && !l.snapped && l.sealed);
      while (leg && token === epoch.current) {
        const coordinates = await requestGpsMatch(leg);
        if (token !== epoch.current) return;
        current.current.commit(acceptMatchedLeg(current.current.getDraft(), leg.id!, coordinates));
        leg = current.current.getDraft().legs.find(l => l.source === 'gps' && !l.snapped && l.sealed);
      }
      if (token === epoch.current) setMessage('Derniers points ajustés · intervalle de 20 s');
    })();
    inFlight.current = work;
    try { await work; }
    catch (e: any) { if (token === epoch.current) { setError(e.message); setMessage('Points GPS conservés · nouvel essai dans 20 s'); } throw e; }
    finally { if (token === epoch.current) { inFlight.current = null; setBusy(false); } }
  };
  const latestFlush = useRef(flush); latestFlush.current = flush;
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => { if (!inFlight.current) void latestFlush.current().catch(() => {}); }, GPS_SNAP_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [recording]);
  const cancel = () => { epoch.current++; inFlight.current = null; setBusy(false); setError(''); setMessage('Ajustement GPS toutes les 20 secondes'); };
  useEffect(() => () => { epoch.current++; }, []);
  return { busy, message, error, flush, cancel };
}
import React, { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { MapSurfaceProps } from './types';

export default function MapSurface({ html, payload, onMessage, testID }: MapSurfaceProps) {
  const ref = useRef<HTMLIFrameElement>(null);
  const ready = useRef(false);
  const latest = useRef({ payload, onMessage });
  useLayoutEffect(() => { latest.current = { payload, onMessage }; }, [payload, onMessage]);
  const send = useCallback(() => {
    ref.current?.contentWindow?.postMessage({ doggoMap: true, payload: latest.current.payload, requestReady: !ready.current }, window.location.origin);
  }, []);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== ref.current?.contentWindow || event.origin !== window.location.origin || !event.data?.doggoMap) return;
      if (event.data.type === 'ready') { ready.current = true; send(); }
      latest.current.onMessage(event.data);
    };
    window.addEventListener('message', receive);
    return () => { window.removeEventListener('message', receive); ready.current = false; };
  }, [send]);
  useEffect(send, [payload, send]);

  return <iframe ref={ref} srcDoc={html} title="Carte des balades Doggo" data-testid={`${testID}-frame`}
    onLoad={send} onError={() => latest.current.onMessage({ type: 'error' })}
    style={{ flex: 1, width: '100%', height: '100%', border: 0, display: 'block' }} />;
}

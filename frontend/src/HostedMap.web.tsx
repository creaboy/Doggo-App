import React, { useCallback, useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';

export default function HostedMap({ url, payload, onMessage, testID }: any) {
  const container = useRef<any>(null);
  const frame = useRef<HTMLIFrameElement | null>(null);
  const latest = useRef({ payload, onMessage }); latest.current = { payload, onMessage };
  const send = useCallback(() => frame.current?.contentWindow?.postMessage({ doggoMap: true, payload: latest.current.payload }, new URL(url).origin), [url]);
  useEffect(() => {
    const iframe = document.createElement('iframe');
    iframe.src = url; iframe.title = 'Carte Google Doggo'; iframe.setAttribute('data-testid', `${testID}-frame`);
    iframe.style.cssText = 'width:100%;height:100%;border:0;display:block;';
    frame.current = iframe; container.current?.appendChild(iframe);
    const receive = (e: MessageEvent) => {
      if (e.source !== iframe.contentWindow || e.origin !== new URL(url).origin || !e.data?.doggoMap) return;
      if (e.data.type === 'ready') send();
      latest.current.onMessage(e.data);
    };
    window.addEventListener('message', receive);
    return () => { window.removeEventListener('message', receive); iframe.remove(); frame.current = null; };
  }, [url, testID, send]);
  useEffect(send, [payload, send]);
  return <View testID={`${testID}-host`} ref={container} style={styles.map} />;
}
const styles = StyleSheet.create({ map: { flex: 1 } });
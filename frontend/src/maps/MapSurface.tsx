import React, { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import type { MapSurfaceProps } from './types';

// Only transport differs between platforms. All map behavior lives in leafletDocument.
export default function MapSurface({ html, payload, onMessage, testID }: MapSurfaceProps) {
  const ref = useRef<WebView<unknown>>(null);
  const ready = useRef(false);
  const latest = useRef({ payload, onMessage });
  useLayoutEffect(() => { latest.current = { payload, onMessage }; }, [payload, onMessage]);
  const send = useCallback(() => {
    if (ready.current) ref.current?.injectJavaScript(`window.__doggoUpdate(${JSON.stringify(latest.current.payload)});true;`);
  }, []);
  useEffect(send, [payload, send]);

  return <WebView<unknown> ref={ref} testID={`${testID}-webview`} source={{ html }} style={styles.map}
    originWhitelist={['*']} javaScriptEnabled domStorageEnabled nestedScrollEnabled scrollEnabled={false}
    setSupportMultipleWindows={false}
    onLoadStart={() => { ready.current = false; }}
    onError={() => latest.current.onMessage({ type: 'error' })}
    onMessage={event => {
      let message;
      try { message = JSON.parse(event.nativeEvent.data); } catch { return; }
      if (!message || !message.doggoMap) return;
      if (message.type === 'ready') { ready.current = true; send(); }
      latest.current.onMessage(message);
    }} />;
}

const styles = StyleSheet.create({ map: { flex: 1 } });

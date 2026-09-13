import React, { useEffect, useRef } from 'react';
import { WebView } from 'react-native-webview';
import { StyleSheet } from 'react-native';

export default function HostedMap({ url, payload, onMessage, testID }: any) {
  const ref = useRef<WebView>(null);
  const ready = useRef(false);
  const send = () => {
    if (ready.current) ref.current?.injectJavaScript(`window.__doggoUpdate(${JSON.stringify(payload)});true;`);
  };
  useEffect(send, [payload]);
  return <WebView ref={ref} testID={`${testID}-webview`} source={{ uri: url }} style={styles.map}
    // '*' autorise aussi les URL locales en http:// (backend lancé sur l'IP du réseau Wi-Fi),
    // sinon iOS bloque la navigation et la carte ne s'affiche jamais.
    originWhitelist={['*']} mixedContentMode="always"
    javaScriptEnabled domStorageEnabled nestedScrollEnabled scrollEnabled={false}
    onLoadStart={() => { ready.current = false; }}
    onError={() => onMessage({ type: 'error' })}
    onMessage={event => {
      try {
        const message = JSON.parse(event.nativeEvent.data);
        if (message.type === 'ready') { ready.current = true; send(); }
        onMessage(message);
      } catch { /* Ignore malformed messages, never execute them. */ }
    }} />;
}
const styles = StyleSheet.create({ map: { flex: 1 } });
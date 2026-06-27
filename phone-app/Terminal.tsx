import { useRef, useEffect } from 'react';
import {
  View, StyleSheet, TouchableOpacity, Text, KeyboardAvoidingView, Platform,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { C, MONO } from './theme';

// Full terminal emulator (xterm.js) in a WebView: real ANSI colors, correct
// monospace alignment, and works with vim/top/htop. PTY data is bridged both ways.
const HTML = `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.css">
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}#t{height:100%;padding:6px;box-sizing:border-box}</style>
</head><body><div id="t"></div>
<script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.js"></script>
<script>
  var RN = window.ReactNativeWebView;
  var term = new Terminal({ fontSize: 12, cursorBlink: true, theme: { background: '#000' } });
  var fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(document.getElementById('t'));
  function doFit(){ try { fit.fit(); } catch(e){} RN.postMessage(JSON.stringify({ t:'size', cols: term.cols, rows: term.rows })); }
  doFit();
  window.addEventListener('resize', doFit);
  term.onData(function(d){ RN.postMessage(JSON.stringify({ t:'data', d: d })); });
  window.writeTerm = function(s){ term.write(s); };
  document.getElementById('t').addEventListener('click', function(){ term.focus(); });
  RN.postMessage(JSON.stringify({ t:'ready' }));
</script></body></html>`;

// special keys the soft keyboard can't produce
const KEYS: { label: string; seq: string }[] = [
  { label: 'esc', seq: '\x1b' },
  { label: 'tab', seq: '\t' },
  { label: '^C', seq: '\x03' },
  { label: '^D', seq: '\x04' },
  { label: '←', seq: '\x1b[D' },
  { label: '↓', seq: '\x1b[B' },
  { label: '↑', seq: '\x1b[A' },
  { label: '→', seq: '\x1b[C' },
];

export default function Terminal({ ws }: { ws: WebSocket | null }) {
  const web = useRef<WebView>(null);
  const ready = useRef(false);
  const buffer = useRef('');

  const sendInput = (data: string) => ws?.send(JSON.stringify({ type: 'term_input', data }));

  // PTY output -> xterm
  useEffect(() => {
    if (!ws) return;
    const handler = (e: MessageEvent) => {
      const msg = JSON.parse(e.data);
      if (msg.type !== 'term_output') return;
      if (ready.current) web.current?.injectJavaScript(`window.writeTerm(${JSON.stringify(msg.data)});true;`);
      else buffer.current += msg.data;
    };
    ws.addEventListener('message', handler);
    return () => ws.removeEventListener('message', handler);
  }, [ws]);

  // xterm -> PTY (typing, and size -> resize the PTY so alignment is correct)
  const onMessage = (e: any) => {
    const msg = JSON.parse(e.nativeEvent.data);
    if (msg.t === 'data') sendInput(msg.d);
    else if (msg.t === 'size') ws?.send(JSON.stringify({ type: 'term_resize', cols: msg.cols, rows: msg.rows }));
    else if (msg.t === 'ready') {
      ready.current = true;
      if (buffer.current) {
        web.current?.injectJavaScript(`window.writeTerm(${JSON.stringify(buffer.current)});true;`);
        buffer.current = '';
      }
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <WebView
        ref={web}
        style={styles.web}
        originWhitelist={['*']}
        source={{ html: HTML }}
        onMessage={onMessage}
        keyboardDisplayRequiresUserAction={false}
        hideKeyboardAccessoryView
        scrollEnabled={false}
      />
      <View style={styles.bar}>
        {KEYS.map((k) => (
          <TouchableOpacity key={k.label} style={styles.key} onPress={() => sendInput(k.seq)}>
            <Text style={styles.keyText}>{k.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  web: { flex: 1, backgroundColor: '#000' },
  bar: {
    flexDirection: 'row', backgroundColor: C.control,
    borderTopWidth: 1, borderTopColor: C.line,
  },
  key: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  keyText: { color: C.fg, fontFamily: MONO, fontSize: 14 },
});

import { useState, useEffect, useRef } from 'react';
import { View, ScrollView, TextInput, Text, StyleSheet } from 'react-native';
import { C, MONO } from './theme';

// ponytail: plain text view, strips nothing. Interactive TUIs (vim/top) print
// raw escape codes here — swap in xterm.js inside a WebView if you need them.
export default function Terminal({ ws }: { ws: WebSocket | null }) {
  const [output, setOutput] = useState('');
  const [input, setInput] = useState('');
  const scroll = useRef<ScrollView>(null);

  useEffect(() => {
    if (!ws) return;
    const handler = (e: MessageEvent) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'term_output') {
        setOutput((p) => (p + msg.data).slice(-20000));
        scroll.current?.scrollToEnd({ animated: false });
      }
    };
    ws.addEventListener('message', handler);
    return () => ws.removeEventListener('message', handler);
  }, [ws]);

  const send = () => {
    ws?.send(JSON.stringify({ type: 'term_input', data: input + '\n' }));
    setInput('');
  };

  return (
    <View style={styles.container}>
      <ScrollView ref={scroll} style={styles.output}>
        <Text style={styles.text}>{output}</Text>
      </ScrollView>
      <View style={styles.inputRow}>
        <Text style={styles.prompt}>›</Text>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          onSubmitEditing={send}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="send"
          placeholder="command"
          placeholderTextColor={C.muted}
          blurOnSubmit={false}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  output: { flex: 1, padding: 16 },
  text: { color: '#d0d0d0', fontFamily: MONO, fontSize: 12, lineHeight: 18 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16,
    borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.control,
  },
  prompt: { color: C.fg, fontFamily: MONO, fontSize: 15, marginRight: 8 },
  input: { flex: 1, color: C.fg, fontFamily: MONO, fontSize: 14, paddingVertical: 14 },
});

import { startTransition, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, StatusBar as RNStatusBar,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Screen from './Screen';
import Terminal from './Terminal';
import { C, MONO } from './theme';

const CMD_PORT = 3001;
const STREAM_PORT = 3002;

type Phase = 'idle' | 'connecting' | 'connected';
type View_ = 'screen' | 'terminal';

const SECTIONS: { id: View_; n: string; title: string; desc: string }[] = [
  { id: 'screen', n: '01', title: 'Screen', desc: 'Live screen — touch to control' },
  { id: 'terminal', n: '02', title: 'Terminal', desc: 'Direct shell and command access' },
];

export default function App() {
  const [host, setHost] = useState('');
  const [token, setToken] = useState('change-this-secret');
  const [phase, setPhase] = useState<Phase>('idle');
  const [status, setStatus] = useState('');
  const [view, setView] = useState<View_ | null>(null);
  const [screen, setScreen] = useState({ width: 1920, height: 1200 });
  const ws = useRef<WebSocket | null>(null);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearStatusTimer = () => {
    if (statusTimer.current) {
      clearTimeout(statusTimer.current);
      statusTimer.current = null;
    }
  };

  useEffect(() => () => {
    clearStatusTimer();
    ws.current?.close();
    ws.current = null;
  }, []);

  const connect = () => {
    const ip = host.trim().split(':')[0];
    if (!ip) return;
    clearStatusTimer();
    ws.current?.close();
    setPhase('connecting');
    setStatus('OPENING SOCKET…');
    const sock = new WebSocket(`ws://${ip}:${CMD_PORT}?token=${encodeURIComponent(token)}`);
    ws.current = sock;
    statusTimer.current = setTimeout(() => {
      if (ws.current === sock && sock.readyState === WebSocket.CONNECTING) {
        setStatus('VERIFYING HANDSHAKE…');
      }
    }, 400);
    sock.addEventListener('message', (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.type === 'screen') setScreen({ width: msg.width, height: msg.height });
    });
    sock.onopen = () => {
      clearStatusTimer();
      startTransition(() => {
        setPhase('connected');
        setView(null);
        setStatus('');
      });
    };
    sock.onclose = () => {
      clearStatusTimer();
      if (ws.current === sock) {
        ws.current = null;
        setPhase('idle');
        setStatus('');
      }
    };
    sock.onerror = () => {
      clearStatusTimer();
      setStatus('CONNECTION FAILED');
    };
  };

  const abort = () => {
    clearStatusTimer();
    ws.current?.close();
    ws.current = null;
    setPhase('idle');
    setStatus('');
  };

  // ── connecting ───────────────────────────────────────────────
  if (phase === 'connecting') {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="light" />
        <View style={styles.connectingBody}>
          <Text style={styles.huge}>CONNECTING{'\n'}TO HOST</Text>
          <View style={styles.rule} />
          <View style={styles.statusRow}>
            <Text style={styles.label}>STATUS</Text>
            <Text style={styles.statusVal}>{status}</Text>
          </View>
          <TouchableOpacity style={styles.outline} onPress={abort}>
            <Text style={styles.outlineText}>ABORT CONNECTION</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── connected: a view is open ────────────────────────────────
  if (phase === 'connected' && view) {
    const sec = SECTIONS.find((s) => s.id === view)!;
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="light" />
        <View style={styles.topbar}>
          <Text style={styles.topTitle}>{sec.title.toUpperCase()}</Text>
          <TouchableOpacity onPress={() => setView(null)} hitSlop={12}>
            <Text style={styles.close}>✕</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.flex}>
          {view === 'screen' && <Screen ws={ws.current} screen={screen} />}
          {view === 'terminal' && <Terminal ws={ws.current} />}
        </View>
      </SafeAreaView>
    );
  }

  // ── connected: interface menu ────────────────────────────────
  if (phase === 'connected') {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="light" />
        <View style={styles.menuHeader}>
          <Text style={styles.h1}>Interface</Text>
          <View style={styles.headRule} />
        </View>
        <View style={styles.flex}>
          {SECTIONS.map((s) => (
            <TouchableOpacity key={s.id} style={styles.sectionRow} onPress={() => setView(s.id)}>
              <Text style={styles.sectionN}>{s.n}</Text>
              <View style={styles.sectionMid}>
                <Text style={styles.sectionTitle}>{s.title}</Text>
                <Text style={styles.sectionDesc}>{s.desc}</Text>
              </View>
              <Text style={styles.arrow}>→</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity style={styles.disconnect} onPress={abort}>
          <Text style={styles.disconnectText}>DISCONNECT</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // ── idle: connect form ───────────────────────────────────────
  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <View style={styles.connectBody}>
        <Text style={styles.huge}>MAC{'\n'}N PHONE</Text>
        <View style={styles.rule} />
        <Text style={styles.label}>HOST</Text>
        <TextInput
          style={styles.field}
          placeholder="192.168.0.108"
          placeholderTextColor={C.muted}
          value={host}
          onChangeText={setHost}
          autoCapitalize="none"
          keyboardType="numbers-and-punctuation"
        />
        <Text style={[styles.label, { marginTop: 24 }]}>SECRET</Text>
        <TextInput
          style={styles.field}
          placeholder="token"
          placeholderTextColor={C.muted}
          value={token}
          onChangeText={setToken}
          autoCapitalize="none"
          secureTextEntry
        />
        <TouchableOpacity style={[styles.outline, { marginTop: 40 }]} onPress={connect}>
          <Text style={styles.outlineText}>CONNECT</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg, paddingTop: RNStatusBar.currentHeight ?? 0 },
  flex: { flex: 1 },

  huge: { color: C.fg, fontSize: 46, fontWeight: '800', letterSpacing: -1, lineHeight: 50 },
  rule: { height: 1, backgroundColor: C.line, marginVertical: 28 },
  label: { color: C.muted, fontSize: 12, letterSpacing: 3, marginBottom: 10 },

  connectBody: { flex: 1, justifyContent: 'center', paddingHorizontal: 28 },
  field: {
    color: C.fg, fontFamily: MONO, fontSize: 18, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: C.faint,
  },

  connectingBody: { flex: 1, justifyContent: 'center', paddingHorizontal: 28 },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  statusVal: { color: C.fg, fontSize: 16, letterSpacing: 1, fontFamily: MONO },

  outline: {
    marginTop: 56, borderWidth: 1, borderColor: C.faint, paddingVertical: 20, alignItems: 'center',
  },
  outlineText: { color: C.fg, fontSize: 14, letterSpacing: 3, fontWeight: '600' },

  menuHeader: { paddingHorizontal: 28, paddingTop: 24 },
  h1: { color: C.fg, fontSize: 34, fontWeight: '700' },
  headRule: { width: 120, height: 3, backgroundColor: C.fg, marginTop: 12 },

  sectionRow: {
    flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 28,
    borderBottomWidth: 1, borderBottomColor: C.line,
  },
  sectionN: { color: C.muted, fontSize: 13, fontFamily: MONO, width: 36 },
  sectionMid: { flex: 1, paddingLeft: 8 },
  sectionTitle: { color: C.fg, fontSize: 40, fontWeight: '700', letterSpacing: -1 },
  sectionDesc: { color: C.muted, fontSize: 14, marginTop: 4 },
  arrow: { color: C.fg, fontSize: 24 },

  disconnect: { paddingVertical: 22, alignItems: 'center', borderTopWidth: 1, borderTopColor: C.line },
  disconnectText: { color: C.muted, fontSize: 13, letterSpacing: 3 },

  topbar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.line,
  },
  topTitle: { color: C.fg, fontSize: 15, letterSpacing: 3, fontWeight: '600' },
  close: { color: C.fg, fontSize: 20 },
});

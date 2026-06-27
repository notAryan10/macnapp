import { useRef, useState, useEffect } from 'react';
import {
  View, PanResponder, StyleSheet, Text, TouchableOpacity, TextInput, LayoutChangeEvent,
} from 'react-native';
import {
  RTCPeerConnection, RTCSessionDescription, RTCIceCandidate, RTCView, MediaStream,
} from 'react-native-webrtc';
import { C, MONO } from './theme';

type Mode = 'MOUSE' | 'SCROLL' | 'DRAG';
const MODES: Mode[] = ['MOUSE', 'SCROLL', 'DRAG'];

type Props = {
  ws: WebSocket | null;
  screen: { width: number; height: number };
};

export default function Screen({ ws, screen }: Props) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [mode, setMode] = useState<Mode>('MOUSE');
  const [kbOpen, setKbOpen] = useState(false);
  const kbBuf = useRef('');
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const send = (m: object) => ws?.readyState === 1 && ws.send(JSON.stringify(m));

  // ── WebRTC: phone is the answerer; daemon sends the offer ──
  useEffect(() => {
    if (!ws) return;
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    pcRef.current = pc;

    (pc as any).addEventListener('track', (e: any) => {
      if (e.streams && e.streams[0]) setStream(e.streams[0]);
    });
    (pc as any).addEventListener('icecandidate', (e: any) => {
      if (e.candidate) send({ type: 'webrtc-ice', candidate: e.candidate });
    });

    const onMsg = async (ev: MessageEvent) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'webrtc-offer') {
        await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: msg.sdp }));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        send({ type: 'webrtc-answer', sdp: answer.sdp });
      } else if (msg.type === 'webrtc-ice' && msg.candidate) {
        try { await pc.addIceCandidate(new RTCIceCandidate(msg.candidate)); } catch {}
      }
    };
    ws.addEventListener('message', onMsg);
    send({ type: 'webrtc-start' });

    return () => {
      ws.removeEventListener('message', onMsg);
      send({ type: 'webrtc-stop' });
      pc.close();
      pcRef.current = null;
    };
  }, [ws]);

  // ── touch -> cursor (unchanged control plane) ──
  const modeRef = useRef(mode); modeRef.current = mode;
  const size = useRef({ w: 1, h: 1 });
  const pendingAbs = useRef<{ nx: number; ny: number } | null>(null);
  const scrollAcc = useRef({ dx: 0, dy: 0 });
  const lastTouch = useRef<{ x: number; y: number } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAt = useRef(0);
  const moved = useRef(0);

  const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const norm = (lx: number, ly: number) => ({
    nx: clamp01(lx / size.current.w),
    ny: clamp01(ly / size.current.h),
  });

  const flush = () => {
    if (modeRef.current === 'SCROLL') {
      const { dx, dy } = scrollAcc.current;
      if (dx || dy) { send({ type: 'scroll', dx: -dx, dy: -dy }); scrollAcc.current = { dx: 0, dy: 0 }; }
    } else if (pendingAbs.current) {
      send({ type: 'moveabs', ...pendingAbs.current });
      pendingAbs.current = null;
    }
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        const { locationX, locationY } = e.nativeEvent;
        startedAt.current = Date.now();
        moved.current = 0;
        lastTouch.current = { x: locationX, y: locationY };
        scrollAcc.current = { dx: 0, dy: 0 };
        if (modeRef.current !== 'SCROLL') {
          pendingAbs.current = norm(locationX, locationY);
          if (modeRef.current === 'DRAG') { flush(); send({ type: 'mousedown', button: 'left' }); }
        }
        timer.current = setInterval(flush, 16);
      },
      onPanResponderMove: (e) => {
        const { locationX, locationY } = e.nativeEvent;
        if (modeRef.current === 'SCROLL') {
          if (lastTouch.current) {
            scrollAcc.current.dx += Math.round((locationX - lastTouch.current.x) * 0.5);
            scrollAcc.current.dy += Math.round((locationY - lastTouch.current.y) * 0.5);
          }
        } else {
          pendingAbs.current = norm(locationX, locationY);
        }
        if (lastTouch.current) {
          moved.current += Math.abs(locationX - lastTouch.current.x) + Math.abs(locationY - lastTouch.current.y);
        }
        lastTouch.current = { x: locationX, y: locationY };
      },
      onPanResponderRelease: () => {
        if (timer.current) clearInterval(timer.current);
        flush();
        if (modeRef.current === 'DRAG') send({ type: 'mouseup', button: 'left' });
        else if (modeRef.current === 'MOUSE' && Date.now() - startedAt.current < 220 && moved.current < 10) {
          send({ type: 'click', button: 'left' });
        }
        lastTouch.current = null;
      },
    })
  ).current;

  const onLayout = (e: LayoutChangeEvent) => {
    size.current = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height };
  };

  const onKb = (t: string) => {
    const prev = kbBuf.current;
    if (t.length > prev.length) send({ type: 'type', text: t.slice(prev.length) });
    else if (t.length < prev.length) send({ type: 'key', key: 'backspace' });
    kbBuf.current = t;
  };

  const aspect = screen.width / screen.height;

  return (
    <View style={styles.container}>
      <View style={styles.stage}>
        <View style={[styles.frame, { aspectRatio: aspect }]} onLayout={onLayout} {...pan.panHandlers}>
          {stream ? (
            <RTCView streamURL={stream.toURL()} style={styles.video} objectFit="contain" />
          ) : (
            <Text style={styles.connecting}>NEGOTIATING STREAM…</Text>
          )}
        </View>
      </View>

      <View style={styles.bar}>
        <View style={styles.modes}>
          {MODES.map((m) => (
            <TouchableOpacity key={m} style={styles.mode} onPress={() => setMode(m)}>
              <Text style={[styles.modeText, mode === m && styles.modeActive]}>{m}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={styles.row}>
          <TouchableOpacity style={styles.btn} onPress={() => send({ type: 'click', button: 'left' })}>
            <Text style={styles.btnText}>L</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.kb} onPress={() => setKbOpen((v) => !v)}>
            <Text style={styles.kbIcon}>⌨</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btn} onPress={() => send({ type: 'click', button: 'right' })}>
            <Text style={styles.btnText}>R</Text>
          </TouchableOpacity>
        </View>
      </View>

      {kbOpen && (
        <TextInput
          style={styles.kbInput}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="type to send keys…"
          placeholderTextColor={C.muted}
          onChangeText={onKb}
          onSubmitEditing={() => { send({ type: 'key', key: 'enter' }); kbBuf.current = ''; }}
          blurOnSubmit={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  stage: { flex: 1, justifyContent: 'center' },
  frame: { width: '100%', backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  video: { width: '100%', height: '100%' },
  connecting: { color: C.muted, fontSize: 13, letterSpacing: 2 },
  bar: { borderTopWidth: 1, borderTopColor: C.line },
  modes: { flexDirection: 'row' },
  mode: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  modeText: { color: C.muted, fontSize: 12, letterSpacing: 2, fontWeight: '600' },
  modeActive: { color: C.fg },
  row: { flexDirection: 'row', padding: 12, gap: 10 },
  btn: { flex: 1, height: 60, backgroundColor: C.control, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  btnText: { color: C.fg, fontSize: 20, fontWeight: '600' },
  kb: { width: 64, height: 60, backgroundColor: C.control, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  kbIcon: { color: C.fg, fontSize: 24 },
  kbInput: { color: C.fg, fontFamily: MONO, fontSize: 15, padding: 14, borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.control },
});

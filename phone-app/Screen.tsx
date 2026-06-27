import { useRef, useState, useEffect } from 'react';
import {
  View, PanResponder, StyleSheet, Text, TouchableOpacity, TextInput, LayoutChangeEvent,
} from 'react-native';
import {
  RTCPeerConnection, RTCSessionDescription, RTCIceCandidate, RTCView, MediaStream,
} from 'react-native-webrtc';
import { C, MONO } from './theme';

type Mode = 'MOUSE' | 'DRAG';
const MODES: Mode[] = ['MOUSE', 'DRAG'];
const MAX_ZOOM = 4;

// Continuous-scroll joystick: deflection sets scroll speed+direction, like Macky.
function ScrollStick({ send }: { send: (m: object) => void }) {
  const R = 38; // max knob deflection (px)
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const knobRef = useRef({ x: 0, y: 0 });
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const tick = () => {
    const { x, y } = knobRef.current;
    const sx = Math.round((x / R) * 6);
    const sy = Math.round((y / R) * 6);
    // push down → scroll down. Flip a sign here if your scroll feels reversed.
    if (sx || sy) send({ type: 'scroll', dx: -sx, dy: -sy });
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => { if (!timer.current) timer.current = setInterval(tick, 50); },
      onPanResponderMove: (_e, g) => {
        let x = g.dx, y = g.dy;
        const d = Math.hypot(x, y);
        if (d > R) { x = (x / d) * R; y = (y / d) * R; }
        knobRef.current = { x, y };
        setKnob({ x, y });
      },
      onPanResponderRelease: () => {
        knobRef.current = { x: 0, y: 0 };
        setKnob({ x: 0, y: 0 });
        if (timer.current) { clearInterval(timer.current); timer.current = null; }
      },
    })
  ).current;

  return (
    <View style={stickStyles.base} {...pan.panHandlers}>
      <View style={[stickStyles.knob, { transform: [{ translateX: knob.x }, { translateY: knob.y }] }]} />
    </View>
  );
}

const stickStyles = StyleSheet.create({
  base: {
    position: 'absolute', bottom: 20, right: 20, width: 104, height: 104, borderRadius: 52,
    backgroundColor: '#000a', borderWidth: 1, borderColor: '#444',
    alignItems: 'center', justifyContent: 'center',
  },
  knob: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff' },
});

type Props = {
  ws: WebSocket | null;
  screen: { width: number; height: number };
};

export default function Screen({ ws, screen }: Props) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [mode, setMode] = useState<Mode>('MOUSE');
  const [kbOpen, setKbOpen] = useState(false);
  const [zoom, setZoom] = useState({ s: 1, tx: 0, ty: 0 });
  const kbBuf = useRef('');
  const send = (m: object) => ws?.readyState === 1 && ws.send(JSON.stringify(m));

  // ── WebRTC: phone is the answerer; daemon sends the offer ──
  useEffect(() => {
    if (!ws) return;
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });

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
    };
  }, [ws]);

  // ── shared refs for control + zoom ──
  const modeRef = useRef(mode); modeRef.current = mode;
  const zoomRef = useRef(zoom); zoomRef.current = zoom;
  const size = useRef({ w: 1, h: 1 });
  const pendingAbs = useRef<{ nx: number; ny: number } | null>(null);
  const scrollAcc = useRef({ dx: 0, dy: 0 });
  const lastTouch = useRef<{ x: number; y: number } | null>(null);
  const pinch = useRef<{ dist: number; mx: number; my: number } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAt = useRef(0);
  const moved = useRef(0);

  const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
  // account for current zoom (transformOrigin: top-left → screen = content*s + t)
  const norm = (lx: number, ly: number) => {
    const z = zoomRef.current;
    return {
      nx: clamp01((lx - z.tx) / z.s / size.current.w),
      ny: clamp01((ly - z.ty) / z.s / size.current.h),
    };
  };

  const flush = () => {
    if (modeRef.current === 'SCROLL') {
      const { dx, dy } = scrollAcc.current;
      if (dx || dy) { send({ type: 'scroll', dx: -dx, dy: -dy }); scrollAcc.current = { dx: 0, dy: 0 }; }
    } else if (pendingAbs.current) {
      send({ type: 'moveabs', ...pendingAbs.current });
      pendingAbs.current = null;
    }
  };

  const stopTimer = () => { if (timer.current) { clearInterval(timer.current); timer.current = null; } };

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
        pinch.current = null;
        if (modeRef.current !== 'SCROLL') {
          pendingAbs.current = norm(locationX, locationY);
          if (modeRef.current === 'DRAG') { flush(); send({ type: 'mousedown', button: 'left' }); }
        }
        timer.current = setInterval(flush, 16);
      },
      onPanResponderMove: (e) => {
        const touches = e.nativeEvent.touches;

        // two fingers → pinch-zoom + pan the view locally (no cursor commands)
        if (touches.length >= 2) {
          stopTimer();
          const a = touches[0], b = touches[1];
          const dist = Math.hypot(a.locationX - b.locationX, a.locationY - b.locationY);
          const mx = (a.locationX + b.locationX) / 2;
          const my = (a.locationY + b.locationY) / 2;
          if (!pinch.current) { pinch.current = { dist, mx, my }; lastTouch.current = null; return; }
          const z = zoomRef.current;
          const factor = dist / pinch.current.dist;
          let ns = Math.max(1, Math.min(MAX_ZOOM, z.s * factor));
          // keep the point under the pinch midpoint fixed, plus follow the pan
          let ntx = mx - (mx - z.tx) * (ns / z.s) + (mx - pinch.current.mx);
          let nty = my - (my - z.ty) * (ns / z.s) + (my - pinch.current.my);
          if (ns <= 1.001) { ns = 1; ntx = 0; nty = 0; }
          setZoom({ s: ns, tx: ntx, ty: nty });
          pinch.current = { dist, mx, my };
          return;
        }

        // single finger → cursor control
        pinch.current = null;
        if (!timer.current) timer.current = setInterval(flush, 16);
        const { locationX, locationY } = e.nativeEvent;
        if (!lastTouch.current) { lastTouch.current = { x: locationX, y: locationY }; }
        if (modeRef.current === 'SCROLL') {
          scrollAcc.current.dx += Math.round((locationX - lastTouch.current.x) * 0.5);
          scrollAcc.current.dy += Math.round((locationY - lastTouch.current.y) * 0.5);
        } else {
          pendingAbs.current = norm(locationX, locationY);
        }
        moved.current += Math.abs(locationX - lastTouch.current.x) + Math.abs(locationY - lastTouch.current.y);
        lastTouch.current = { x: locationX, y: locationY };
      },
      onPanResponderRelease: () => {
        stopTimer();
        flush();
        if (!pinch.current) {
          if (modeRef.current === 'DRAG') send({ type: 'mouseup', button: 'left' });
          else if (modeRef.current === 'MOUSE' && Date.now() - startedAt.current < 220 && moved.current < 10) {
            send({ type: 'click', button: 'left' });
          }
        }
        lastTouch.current = null;
        pinch.current = null;
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
            <View
              style={[
                StyleSheet.absoluteFill,
                { transformOrigin: 'top left', transform: [{ translateX: zoom.tx }, { translateY: zoom.ty }, { scale: zoom.s }] },
              ]}
              pointerEvents="none"
            >
              <RTCView streamURL={stream.toURL()} style={styles.video} objectFit="contain" />
            </View>
          ) : (
            <Text style={styles.connecting}>NEGOTIATING STREAM…</Text>
          )}
        </View>
        {zoom.s > 1 && (
          <TouchableOpacity style={styles.reset} onPress={() => setZoom({ s: 1, tx: 0, ty: 0 })}>
            <Text style={styles.resetText}>{zoom.s.toFixed(1)}× · reset</Text>
          </TouchableOpacity>
        )}
        {stream && <ScrollStick send={send} />}
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
  frame: { width: '100%', backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  video: { width: '100%', height: '100%' },
  connecting: { color: C.muted, fontSize: 13, letterSpacing: 2 },
  reset: {
    position: 'absolute', top: 12, right: 12, backgroundColor: '#000a',
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: C.faint,
  },
  resetText: { color: C.fg, fontSize: 12, fontFamily: MONO },
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

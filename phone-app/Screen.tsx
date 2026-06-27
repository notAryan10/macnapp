import { useRef, useState } from 'react';
import {
  View, PanResponder, StyleSheet, Text, TouchableOpacity, TextInput, LayoutChangeEvent,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { C, MONO } from './theme';

type Mode = 'MOUSE' | 'SCROLL' | 'DRAG';
const MODES: Mode[] = ['MOUSE', 'SCROLL', 'DRAG'];

type Props = {
  ws: WebSocket | null;
  host: string;
  streamPort: number;
  screen: { width: number; height: number };
};

export default function Screen({ ws, host, streamPort, screen }: Props) {
  const ip = host.trim().split(':')[0];
  const player = useVideoPlayer(`http://${ip}:${streamPort}/index.m3u8`, (p) => { p.loop = false; p.play(); });

  const [mode, setMode] = useState<Mode>('MOUSE');
  const [kbOpen, setKbOpen] = useState(false);
  const kbBuf = useRef('');
  const send = (m: object) => ws?.readyState === 1 && ws.send(JSON.stringify(m));

  const modeRef = useRef(mode); modeRef.current = mode;
  const size = useRef({ w: 1, h: 1 });               // video container px size
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
        if (modeRef.current === 'SCROLL') {
          // nothing to send yet
        } else {
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
          send({ type: 'click', button: 'left' }); // tap = click where you touched
        }
        lastTouch.current = null;
      },
    })
  ).current;

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    size.current = { w: width, h: height };
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
          <VideoView style={styles.video} player={player} contentFit="fill" nativeControls={false} pointerEvents="none" />
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
  frame: { width: '100%', backgroundColor: '#000' },
  video: { width: '100%', height: '100%' },
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

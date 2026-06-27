const { RTCPeerConnection, RTCRtpCodecParameters, MediaStreamTrack } = require('werift');
const dgram = require('dgram');
const { spawn } = require('child_process');

const SCREEN = process.env.AVF_SCREEN_INDEX || '1';
const RTP_PORT = Number(process.env.RTP_PORT || 5004);
const PT = 96; // dynamic payload type for H.264, must match ffmpeg -payload_type

// One screen-streaming session per phone connection. ffmpeg runs on demand so
// there's never a second avfoundation capture fighting the first.
function createSession(ws) {
  let pc = null, ff = null, udp = null;
  const send = (m) => ws.readyState === 1 && ws.send(JSON.stringify(m));

  async function start() {
    stop();
    pc = new RTCPeerConnection({
      codecs: {
        video: [
          new RTCRtpCodecParameters({
            mimeType: 'video/H264',
            clockRate: 90000,
            payloadType: PT,
            rtcpFeedback: [
              { type: 'nack' },
              { type: 'nack', parameter: 'pli' },
              { type: 'goog-remb' },
            ],
            parameters: 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f',
          }),
        ],
      },
    });

    const track = new MediaStreamTrack({ kind: 'video' });
    pc.addTransceiver(track, { direction: 'sendonly' });

    pc.onIceCandidate.subscribe((candidate) => candidate && send({ type: 'webrtc-ice', candidate }));

    // ffmpeg RTP (UDP) -> WebRTC track
    udp = dgram.createSocket('udp4');
    udp.on('message', (buf) => { try { track.writeRtp(buf); } catch {} });
    udp.bind(RTP_PORT);

    ff = spawn('ffmpeg', [
      '-f', 'avfoundation', '-capture_cursor', '1', '-framerate', '30',
      '-use_wallclock_as_timestamps', '1', '-i', SCREEN,
      '-fps_mode', 'cfr', '-r', '30', '-vf', 'scale=1280:-2',
      // libx264 baseline + zerolatency = the WebRTC-friendly, low-latency choice
      '-c:v', 'libx264', '-profile:v', 'baseline', '-level', '3.1',
      '-pix_fmt', 'yuv420p', '-tune', 'zerolatency', '-b:v', '3000k', '-g', '60', '-an',
      '-f', 'rtp', '-payload_type', String(PT), `rtp://127.0.0.1:${RTP_PORT}?pkt_size=1200`,
    ], { stdio: ['ignore', 'ignore', 'inherit'] });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    send({ type: 'webrtc-offer', sdp: pc.localDescription.sdp });
  }

  async function onAnswer(sdp) { if (pc) await pc.setRemoteDescription({ type: 'answer', sdp }); }
  async function onIce(candidate) { try { if (pc && candidate) await pc.addIceCandidate(candidate); } catch {} }

  function stop() {
    try { ff && ff.kill('SIGKILL'); } catch {}
    try { udp && udp.close(); } catch {}
    try { pc && pc.close(); } catch {}
    ff = udp = pc = null;
  }

  return { start, onAnswer, onIce, stop };
}

module.exports = { createSession };

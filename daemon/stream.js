const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ponytail: screen device index varies per Mac. Find yours with:
//   ffmpeg -f avfoundation -list_devices true -i "" 2>&1 | grep -i 'screen\|capture'
// then set AVF_SCREEN_INDEX. Defaults to "1" (typical single-display Mac).
const SCREEN = process.env.AVF_SCREEN_INDEX || '1';
const STREAM_PORT = Number(process.env.STREAM_PORT || 3002);

// HLS output dir — segments live here, served over HTTP. ExoPlayer/AVPlayer
// both speak HLS natively (raw MPEG-TS over HTTP does not work on mobile).
const DIR = path.join(os.tmpdir(), 'macnphone-hls');
const TYPES = { '.m3u8': 'application/vnd.apple.mpegurl', '.ts': 'video/mp2t' };

exports.startStream = () => {
  // Keep the display awake while the daemon runs — avfoundation captures
  // nothing when the screen sleeps. (Can't bypass a *locked* session though.)
  spawn('caffeinate', ['-dimsu'], { stdio: 'ignore' });

  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(DIR, { recursive: true });

  http
    .createServer((req, res) => {
      const name = path.basename(req.url.split('?')[0]) || 'index.m3u8';
      const file = path.join(DIR, name);
      if (!file.startsWith(DIR) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(name)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
      });
      fs.createReadStream(file).pipe(res);
    })
    .listen(STREAM_PORT, () => {
      console.log(`Stream (HLS) on http://localhost:${STREAM_PORT}/index.m3u8`);
      spawnFfmpeg();
    });
};

function spawnFfmpeg() {
  const ff = spawn('ffmpeg', [
    '-f', 'avfoundation',
    '-capture_cursor', '1',
    '-framerate', '30',
    '-i', SCREEN,
    '-vf', 'scale=1280:-2',
    '-c:v', 'h264_videotoolbox',
    '-realtime', '1',
    '-b:v', '4000k',
    '-g', '30',
    '-pix_fmt', 'yuv420p',
    '-f', 'hls',
    '-hls_time', '1',                 // 1s segments — keeps latency low-ish
    '-hls_list_size', '4',
    '-hls_flags', 'delete_segments+omit_endlist+independent_segments',
    path.join(DIR, 'index.m3u8'),
  ], { stdio: ['ignore', 'ignore', 'inherit'] });

  // ponytail: naive restart-on-crash. Fine for a personal tool.
  ff.on('exit', (code) => {
    console.log(`ffmpeg exited (${code}), restarting in 2s`);
    setTimeout(spawnFfmpeg, 2000);
  });
}

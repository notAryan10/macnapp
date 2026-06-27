const { WebSocketServer } = require('ws');
const { spawn } = require('child_process');
const input = require('./input');
const { createTerminal } = require('./terminal');
const { createSession } = require('./webrtc');
const { isAuthorized } = require('./auth');
const {
  CLOSE_CODE,
  allowConnection,
  allowMessage,
  allowUnauthorizedAttempt,
} = require('./rate-limit');

const PORT = Number(process.env.CMD_PORT || 3001);
const wss = new WebSocketServer({ port: PORT });
console.log(`Command channel on ws://localhost:${PORT}`);
let nextSessionId = 1;

// Keep the display awake while the daemon runs — avfoundation captures nothing
// when the screen sleeps. (Can't bypass a *locked* session though.)
spawn('caffeinate', ['-dimsu'], { stdio: 'ignore' });

wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress || 'unknown';
  if (!allowConnection(clientIp)) {
    ws.close(CLOSE_CODE, 'Too many connections');
    return;
  }
  if (!isAuthorized(req.url)) {
    const closeCode = allowUnauthorizedAttempt(clientIp) ? 4001 : CLOSE_CODE;
    const reason = closeCode === 4001 ? 'Unauthorized' : 'Too many auth attempts';
    ws.close(closeCode, reason);
    return;
  }
  const sessionId = `${clientIp}#${nextSessionId++}`;
  ws._socket.setNoDelay(true); // disable Nagle — send move packets immediately
  ws.send(JSON.stringify({ type: 'screen', ...input.screenSize })); // for touch mapping
  console.log('Phone connected');
  const term = createTerminal(ws);
  const rtc = createSession(ws);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!allowMessage(sessionId, msg)) {
      ws.close(CLOSE_CODE, 'Rate limited');
      return;
    }
    switch (msg.type) {
      case 'move': input.moveCursor(msg); break;
      case 'moveabs': input.moveAbs(msg); break;
      case 'click': input.click(msg); break;
      case 'mousedown': input.mouseDown(msg); break;
      case 'mouseup': input.mouseUp(msg); break;
      case 'scroll': input.scroll(msg); break;
      case 'key': input.typeKey(msg); break;
      case 'type': input.typeString(msg); break;
      case 'term_input': term.write(msg.data); break;
      case 'term_resize': try { term.resize(msg.cols, msg.rows); } catch {} break;
      case 'webrtc-start': rtc.start().catch((e) => console.error('rtc start', e)); break;
      case 'webrtc-answer': rtc.onAnswer(msg.sdp); break;
      case 'webrtc-ice': rtc.onIce(msg.candidate); break;
      case 'webrtc-stop': rtc.stop(); break;
    }
  });

  ws.on('close', () => { rtc.stop(); term.kill(); });
});

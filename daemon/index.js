const { WebSocketServer } = require('ws');
const input = require('./input');
const { startStream } = require('./stream');
const { createTerminal } = require('./terminal');
const { isAuthorized } = require('./auth');

const PORT = Number(process.env.CMD_PORT || 3001);
const wss = new WebSocketServer({ port: PORT });
console.log(`Command channel on ws://localhost:${PORT}`);

wss.on('connection', (ws, req) => {
  if (!isAuthorized(req.url)) {
    ws.close(4001, 'Unauthorized');
    return;
  }
  ws._socket.setNoDelay(true); // disable Nagle — send move packets immediately
  ws.send(JSON.stringify({ type: 'screen', ...input.screenSize })); // for touch mapping
  console.log('Phone connected');
  const term = createTerminal(ws);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
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
    }
  });

  ws.on('close', () => term.kill());
});

startStream();

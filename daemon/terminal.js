const pty = require('node-pty');

exports.createTerminal = (ws) => {
  const term = pty.spawn(process.env.SHELL || '/bin/zsh', [], {
    name: 'xterm-color',
    cols: 80,
    rows: 24,
    cwd: process.env.HOME,
    env: process.env,
  });

  term.onData((data) => {
    if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'term_output', data }));
  });

  return term;
};

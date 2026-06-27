const robot = require('robotjs');

const { width: SW, height: SH } = robot.getScreenSize();
robot.setMouseDelay(0); // we want raw speed, not robotjs's default throttle

const clamp = (v, max) => Math.max(0, Math.min(max, v));

exports.moveCursor = ({ dx = 0, dy = 0 }) => {
  const { x, y } = robot.getMousePos();
  robot.moveMouse(clamp(x + dx, SW), clamp(y + dy, SH));
};

// Absolute move from normalized 0..1 coords (phone touch on the live screen).
exports.moveAbs = ({ nx = 0, ny = 0 }) =>
  robot.moveMouse(clamp(nx * SW, SW), clamp(ny * SH, SH));

exports.screenSize = { width: SW, height: SH };

exports.click = ({ button = 'left', double = false }) =>
  robot.mouseClick(button, double);

exports.mouseDown = ({ button = 'left' }) => robot.mouseToggle('down', button);
exports.mouseUp = ({ button = 'left' }) => robot.mouseToggle('up', button);

exports.scroll = ({ dx = 0, dy = 0 }) => robot.scrollMouse(dx, dy);

exports.typeKey = ({ key, modifiers = [] }) => robot.keyTap(key, modifiers);

exports.typeString = ({ text }) => robot.typeString(text);

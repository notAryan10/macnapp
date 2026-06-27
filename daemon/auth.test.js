// Smallest thing that fails if the auth gate breaks. Run: npm test
const assert = require('assert');
process.env.REMOTE_SECRET = 'sekret';
delete require.cache[require.resolve('./auth')];
const { isAuthorized } = require('./auth');

assert.equal(isAuthorized('/?token=sekret'), true, 'correct token accepted');
assert.equal(isAuthorized('/?token=wrong'), false, 'wrong token rejected');
assert.equal(isAuthorized('/'), false, 'missing token rejected');
console.log('auth ok');

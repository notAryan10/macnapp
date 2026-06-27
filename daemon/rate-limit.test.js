const assert = require('assert');
const {
  createMessageRateLimiter,
  createTokenBucket,
} = require('./rate-limit');

const bucket = createTokenBucket({ capacity: 2, refillPerSec: 1 });
assert.equal(bucket.take('phone', 1, 0), true, 'first token accepted');
assert.equal(bucket.take('phone', 1, 0), true, 'burst capacity accepted');
assert.equal(bucket.take('phone', 1, 0), false, 'bucket rejects when empty');
assert.equal(bucket.take('phone', 1, 1100), true, 'bucket refills over time');

const limiter = createMessageRateLimiter({
  highFreq: { capacity: 2, refillPerSec: 1 },
  interactive: { capacity: 3, refillPerSec: 1 },
  terminal: { capacity: 4, refillPerSec: 1 },
  session: { capacity: 2, refillPerSec: 1 },
});

assert.equal(limiter.allow('session', { type: 'moveabs' }, 0), true, 'high-frequency message accepted');
assert.equal(limiter.allow('session', { type: 'moveabs' }, 0), true, 'high-frequency burst accepted');
assert.equal(limiter.allow('session', { type: 'moveabs' }, 0), false, 'high-frequency limit enforced');

assert.equal(limiter.allow('session', { type: 'type', text: 'hello' }, 0), true, 'short text accepted');
assert.equal(
  limiter.allow('session', { type: 'type', text: 'x'.repeat(160) }, 0),
  false,
  'large text payload costs multiple tokens'
);

assert.equal(limiter.allow('term', { type: 'term_input', data: 'x'.repeat(128) }, 0), true, 'terminal input accepted');
assert.equal(limiter.allow('term', { type: 'term_input', data: 'x'.repeat(385) }, 0), false, 'terminal bursts are capped');

assert.equal(limiter.allow('rtc', { type: 'webrtc-start' }, 0), true, 'session control accepted');
assert.equal(limiter.allow('rtc', { type: 'webrtc-answer' }, 0), true, 'session burst accepted');
assert.equal(limiter.allow('rtc', { type: 'webrtc-ice' }, 0), false, 'session limit enforced');

console.log('rate limit ok');

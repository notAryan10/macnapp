const CLOSE_CODE = 4008;

function readNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function createTokenBucket({ capacity, refillPerSec }) {
  const entries = new Map();

  function refill(entry, now) {
    const elapsedMs = Math.max(0, now - entry.updatedAt);
    const tokens = Math.min(capacity, entry.tokens + ((elapsedMs / 1000) * refillPerSec));
    entry.tokens = tokens;
    entry.updatedAt = now;
    return entry;
  }

  return {
    take(key, cost = 1, now = Date.now()) {
      const entry = refill(entries.get(key) || { tokens: capacity, updatedAt: now }, now);
      if (entry.tokens < cost) {
        entries.set(key, entry);
        return false;
      }
      entry.tokens -= cost;
      entries.set(key, entry);
      return true;
    },
    reset() {
      entries.clear();
    },
  };
}

function readPolicy(prefix, defaults) {
  return {
    capacity: readNumber(`${prefix}_BURST`, defaults.capacity),
    refillPerSec: readNumber(`${prefix}_RATE`, defaults.refillPerSec),
  };
}

function createMessageRateLimiter(config = {}) {
  const highFreq = createTokenBucket(config.highFreq || readPolicy('HIGH_FREQ_LIMIT', { capacity: 180, refillPerSec: 90 }));
  const interactive = createTokenBucket(config.interactive || readPolicy('INTERACTIVE_LIMIT', { capacity: 40, refillPerSec: 20 }));
  const terminal = createTokenBucket(config.terminal || readPolicy('TERMINAL_LIMIT', { capacity: 30, refillPerSec: 15 }));
  const session = createTokenBucket(config.session || readPolicy('SESSION_LIMIT', { capacity: 20, refillPerSec: 10 }));

  function bucketForMessage(type) {
    switch (type) {
      case 'move':
      case 'moveabs':
      case 'scroll':
        return highFreq;
      case 'click':
      case 'mousedown':
      case 'mouseup':
      case 'key':
      case 'type':
        return interactive;
      case 'term_input':
      case 'term_resize':
        return terminal;
      case 'webrtc-start':
      case 'webrtc-answer':
      case 'webrtc-ice':
      case 'webrtc-stop':
        return session;
      default:
        return interactive;
    }
  }

  function costForMessage(msg) {
    switch (msg.type) {
      case 'type':
        return Math.max(1, Math.ceil(String(msg.text || '').length / 64));
      case 'term_input':
        return Math.max(1, Math.ceil(String(msg.data || '').length / 128));
      default:
        return 1;
    }
  }

  return {
    allow(key, msg, now = Date.now()) {
      return bucketForMessage(msg.type).take(key, costForMessage(msg), now);
    },
  };
}

const connectionLimiter = createTokenBucket(readPolicy('CONNECTION_LIMIT', { capacity: 8, refillPerSec: 0.2 }));
const authLimiter = createTokenBucket(readPolicy('AUTH_LIMIT', { capacity: 5, refillPerSec: 0.05 }));
const messageLimiter = createMessageRateLimiter();

function allowConnection(clientIp, now) {
  return connectionLimiter.take(clientIp, 1, now);
}

function allowUnauthorizedAttempt(clientIp, now) {
  return authLimiter.take(clientIp, 1, now);
}

function allowMessage(sessionId, msg, now) {
  return messageLimiter.allow(sessionId, msg, now);
}

module.exports = {
  CLOSE_CODE,
  allowConnection,
  allowMessage,
  allowUnauthorizedAttempt,
  createMessageRateLimiter,
  createTokenBucket,
};

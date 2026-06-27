// Shared-secret gate for the command WebSocket. Security boundary — keep it.
const SECRET = process.env.REMOTE_SECRET || 'change-this-secret';

// Pure so it's testable without a live socket. token comes from ?token= query.
function isAuthorized(reqUrl) {
  const url = new URL(reqUrl || '/', 'ws://localhost');
  return url.searchParams.get('token') === SECRET;
}

module.exports = { isAuthorized, SECRET };

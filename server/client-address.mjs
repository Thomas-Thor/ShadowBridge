import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

// Only the private edge can attest the source address. Caddy must overwrite
// both headers, and the app port must remain unpublished. Browser-supplied
// Forwarded/X-Forwarded-For headers never influence application rate limits.
export function clientAddress(req, config) {
  const peer = req.socket?.remoteAddress || 'unknown';
  const expected = config.proxyAuthToken;
  const supplied = req.headers?.['x-shadowbridge-proxy-token'];
  const address = req.headers?.['x-shadowbridge-client-ip'];
  if (typeof expected !== 'string' || !expected || typeof supplied !== 'string'
      || typeof address !== 'string' || !isIP(address) || supplied.length > 256) return peer;
  const left = Buffer.from(expected), right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right) ? address : peer;
}

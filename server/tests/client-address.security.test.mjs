import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { clientAddress } from '../client-address.mjs';

const token = randomBytes(32).toString('base64url');
const peer = '172.29.0.3';
const request = headers => ({ socket: { remoteAddress: peer }, headers });
const attested = address => ({ 'x-shadowbridge-proxy-token': token, 'x-shadowbridge-client-ip': address });

test('untrusted forwarding headers cannot change a client rate-limit identity', () => {
  const forged = { ...attested('203.0.113.10'), 'x-forwarded-for': '198.51.100.4', forwarded: 'for=198.51.100.5' };
  assert.equal(clientAddress(request(forged), {}), peer, 'No configured edge secret means no forwarded trust');
  for (const headers of [
    { 'x-forwarded-for': '198.51.100.4' },
    { forwarded: 'for=198.51.100.5' },
    { 'x-shadowbridge-client-ip': '203.0.113.10' },
    { ...attested('203.0.113.10'), 'x-shadowbridge-proxy-token': randomBytes(32).toString('base64url') },
  ]) assert.equal(clientAddress(request(headers), { proxyAuthToken: token }), peer);
});

test('authenticated edge separates real IPv4 and IPv6 clients behind the same proxy', () => {
  const config = { proxyAuthToken: token };
  for (const address of ['203.0.113.10', '198.51.100.11', '2001:db8::42', '::ffff:203.0.113.10']) {
    assert.equal(clientAddress(request(attested(address)), config), address);
  }
  assert.notEqual(clientAddress(request(attested('203.0.113.10')), config), clientAddress(request(attested('203.0.113.11')), config));
});

test('malformed, repeated and ambiguous trusted headers fall back to the actual peer', () => {
  const config = { proxyAuthToken: token };
  for (const address of ['', 'not-an-IP', '203.0.113.10,198.51.100.5', '203.0.113.10:443', ' 203.0.113.10', ['203.0.113.10']]) {
    assert.equal(clientAddress(request(attested(address)), config), peer);
  }
  for (const supplied of [undefined, '', token+', '+token, [token], 'x'.repeat(257), token+'x']) {
    assert.equal(clientAddress(request({ ...attested('203.0.113.10'), 'x-shadowbridge-proxy-token': supplied }), config), peer);
  }
  assert.equal(clientAddress({ headers: {} }, config), 'unknown');
});

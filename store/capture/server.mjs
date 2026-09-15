// Realistic-looking demo API for store screenshots: https://api.example.com (mapped to 127.0.0.1:8443).
// Needs key.pem and cert.pem beside it (see CLAUDE.md "Store listing assets"); they are git-ignored.
import https from 'node:https';
import fs from 'node:fs';
import crypto from 'node:crypto';

const dir = new URL('.', import.meta.url).pathname;
const tokens = new Set();
const codes = new Map();

const customers = [
  { id: 'cus_7Hq2', name: 'Amelia Hart', email: 'amelia@harthouse.co', tier: 'gold', since: '2023-04-11' },
  { id: 'cus_3Lm9', name: 'Diego Ramos', email: 'diego.ramos@fastmail.com', tier: 'silver', since: '2024-01-29' },
];
const orders = [
  { id: 'ord_1042', status: 'shipped', total: 128.4, currency: 'USD', customer: 'cus_7Hq2', items: [{ sku: 'LAMP-OAK-01', name: 'Oak desk lamp', qty: 1, price: 89.0 }, { sku: 'BULB-E27-2P', name: 'Warm LED bulbs (2)', qty: 2, price: 19.7 }], created_at: '2026-09-12T14:22:05Z', tracking: { carrier: 'UPS', number: '1Z999AA10123456784' } },
  { id: 'ord_1043', status: 'shipped', total: 42.0, currency: 'USD', customer: 'cus_3Lm9', items: [{ sku: 'MUG-STN-GRY', name: 'Stoneware mug, grey', qty: 3, price: 14.0 }], created_at: '2026-09-13T09:03:41Z', tracking: { carrier: 'USPS', number: '9400111202555842761023' } },
  { id: 'ord_1044', status: 'processing', total: 312.99, currency: 'USD', customer: 'cus_7Hq2', items: [{ sku: 'CHAIR-WAL-01', name: 'Walnut side chair', qty: 1, price: 312.99 }], created_at: '2026-09-14T18:47:12Z', tracking: null },
];

function readBody(req) {
  return new Promise((resolve) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => resolve(Buffer.concat(c).toString())); });
}

const server = https.createServer({ key: fs.readFileSync(dir + 'key.pem'), cert: fs.readFileSync(dir + 'cert.pem') }, async (req, res) => {
  const url = new URL(req.url, 'https://api.example.com');
  const path = url.pathname;
  const body = await readBody(req);
  const json = (code, obj, headers = {}) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'x-request-id': 'req_' + crypto.randomBytes(6).toString('hex'), 'ratelimit-remaining': '4987', ...headers }); res.end(JSON.stringify(obj)); };
  const authed = () => tokens.has((req.headers.authorization || '').replace(/^Bearer\s+/i, '')) || (req.headers.authorization || '').startsWith('Bearer sk_live_demo');

  if (path === '/oauth/token' && req.method === 'POST') {
    const token = 'eyJhbGciOiJSUzI1NiJ9.' + crypto.randomBytes(18).toString('base64url');
    tokens.add(token);
    return json(200, { access_token: token, token_type: 'Bearer', expires_in: 3600, refresh_token: 'rt_' + crypto.randomBytes(8).toString('hex'), scope: 'orders:read orders:write' });
  }
  if (path === '/oauth/authorize') {
    const target = new URL(url.searchParams.get('redirect_uri'));
    const code = 'c_' + crypto.randomBytes(6).toString('hex');
    codes.set(code, true);
    target.searchParams.set('code', code);
    target.searchParams.set('state', url.searchParams.get('state') || '');
    res.writeHead(302, { location: target.toString() });
    return res.end();
  }
  if (path === '/v1/orders' && req.method === 'GET') {
    const status = url.searchParams.get('status');
    const data = orders.filter((o) => !status || o.status === status);
    return json(200, { data, page: { limit: Number(url.searchParams.get('limit') || 20), next_cursor: null }, total: data.length }, { 'set-cookie': 'session_region=us-east; Path=/; Secure; HttpOnly; SameSite=Lax' });
  }
  if (path === '/v1/orders' && req.method === 'POST') {
    let input = {};
    try { input = JSON.parse(body || '{}'); } catch { return json(400, { error: { code: 'invalid_json', message: 'Body must be JSON' } }); }
    return json(201, { id: 'ord_1045', status: 'pending', ...input, created_at: new Date().toISOString() }, { location: '/v1/orders/ord_1045' });
  }
  if (path.startsWith('/v1/orders/')) {
    const o = orders.find((x) => x.id === path.split('/')[3]);
    if (req.method === 'DELETE') return json(409, { error: { code: 'order_shipped', message: 'Shipped orders cannot be cancelled.' } });
    return o ? json(200, o) : json(404, { error: { code: 'not_found', message: 'No such order' } });
  }
  if (path.startsWith('/v1/customers/')) {
    const c = customers.find((x) => x.id === path.split('/')[3]);
    return c ? json(200, c) : json(404, { error: { code: 'not_found', message: 'No such customer' } });
  }
  if (path === '/v1/me') return authed() ? json(200, { id: 'usr_42', name: 'Store Admin', scopes: ['orders:read', 'orders:write'] }) : json(401, { error: { code: 'unauthorized', message: 'Missing or invalid token' } });
  if (path === '/v1/inventory/low-stock') return json(200, { data: [{ sku: 'MUG-STN-GRY', on_hand: 4 }], threshold: 5 });
  if (path === '/v1/health') return json(503, { status: 'degraded', checks: { database: 'ok', search: 'timeout' } });
  return json(404, { error: { code: 'not_found', message: `No route for ${req.method} ${path}` } });
});
server.listen(8443, '127.0.0.1', () => console.log('store fixture on https://127.0.0.1:8443'));

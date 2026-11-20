// Local dev server: runs the /api functions like Vercel does, serves /public,
// and (with MOCK=1) fakes Upstash Redis and the osu! API so the whole game can be played offline.
//   MOCK=1 SESSION_SECRET=devsecretdevsecret node dev/server.js
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3000);
const MOCK = process.env.MOCK === '1';
const ORIGIN = `http://localhost:${PORT}`;

if (MOCK) {
  Object.assign(process.env, {
    KV_REST_API_URL: `${ORIGIN}/__redis`, KV_REST_API_TOKEN: 'mock',
    OSU_BASE: `${ORIGIN}/__osu`, OSU_PREVIEW_BASE: `${ORIGIN}/__media`, OSU_ASSETS_BASE: `${ORIGIN}/__media`,
    OSU_CLIENT_ID: '1', OSU_CLIENT_SECRET: 'x', INSECURE_COOKIES: '1', BASE_URL: ORIGIN,
  });
}

// ---------- mock Upstash ----------
const db = new Map();
const H = (k) => { if (!db.has(k)) db.set(k, new Map()); return db.get(k); };
function redis(c) {
  const [op, k, ...a] = c; const O = op.toUpperCase();
  switch (O) {
    case 'GET': return db.has(k) ? db.get(k) : null;
    case 'SET': db.set(k, a[0]); return 'OK';
    case 'DEL': { let n = 0; for (const x of [k, ...a]) n += db.delete(x) ? 1 : 0; return n; }
    case 'HSET': H(k).set(a[0], a[1]); return 1;
    case 'HSETNX': if (H(k).has(a[0])) return 0; H(k).set(a[0], a[1]); return 1;
    case 'HGET': return db.get(k)?.get(a[0]) ?? null;
    case 'HMGET': return a.map((f) => db.get(k)?.get(f) ?? null);
    case 'HGETALL': return [...(db.get(k) || new Map())].flat();
    case 'HLEN': return db.get(k)?.size || 0;
    case 'ZINCRBY': { const z = H(k); const v = Number(z.get(a[1]) || 0) + Number(a[0]); z.set(a[1], v); return String(v); }
    case 'ZSCORE': return db.get(k)?.has(a[0]) ? String(db.get(k).get(a[0])) : null;
    case 'ZCARD': return db.get(k)?.size || 0;
    case 'ZREVRANGE': case 'ZREVRANK': {
      const z = [...(db.get(k) || new Map())].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1));
      if (O === 'ZREVRANK') { const i = z.findIndex((x) => x[0] === a[0]); return i < 0 ? null : i; }
      const s = Number(a[0]), e = Number(a[1]) < 0 ? z.length : Number(a[1]) + 1;
      return z.slice(s, e).flatMap(([m, v]) => [m, String(v)]);
    }
    default: return { error: `mock does not support ${O}` };
  }
}

// ---------- mock osu! ----------
const SETS = MOCK ? JSON.parse(fs.readFileSync(path.join(ROOT, 'dev/fixtures/beatmapsets.json'), 'utf8')) : [];
const users = {};
const mockUser = (name) => (users[name] ||= { id: 1000 + Object.keys(users).length, username: name, avatar_url: `https://a.ppy.sh/${1000 + Object.keys(users).length}`, country_code: 'SG' });
if (MOCK) users.Purl = { id: 19350047, username: 'Purl', avatar_url: 'https://a.ppy.sh/19350047', country_code: 'SG' };

async function mockOsu(req, res, url, body) {
  const p = url.pathname.replace('/__osu', '');
  const json = (o, s = 200) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (p === '/oauth/authorize') {
    // Pretend the user approved. The test picks the account with the mock_user cookie.
    const name = decodeURIComponent((req.headers.cookie || '').match(/mock_user=([^;]+)/)?.[1] || 'Purl');
    res.writeHead(302, { Location: `${url.searchParams.get('redirect_uri')}?code=${encodeURIComponent(name)}&state=${url.searchParams.get('state')}` });
    return res.end();
  }
  if (p === '/oauth/token') { const b = JSON.parse(body || '{}'); return json({ access_token: b.code ? `user:${b.code}` : 'app', expires_in: 86400 }); }
  const auth = req.headers.authorization || '';
  if (p.startsWith('/api/v2/me')) return json(mockUser(decodeURIComponent(auth.replace('Bearer user:', ''))));
  let m = p.match(/^\/osu\/(\d+)$/);
  if (m) {
    const f = path.join(ROOT, 'dev/fixtures/osu', `${m[1]}.osu`);
    if (!fs.existsSync(f)) return json({ error: 'nf' }, 404);
    res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end(fs.readFileSync(f));
  }
  m = p.match(/^\/api\/v2\/beatmaps\/(\d+)\/scores$/);
  if (m) {
    const id = Number(m[1]);
    return json({ scores: [{ accuracy: 0.9871, max_combo: 1000 + (id % 700), mods: [{ acronym: id % 2 ? 'HD' : 'DT' }, { acronym: 'CL' }], statistics: { great: 1290, ok: 21, meh: 1, miss: 0 },
      rank: id % 2 ? 'SH' : 'A', pp: 900 + (id % 300), legacy_total_score: 98765432, total_score: 1012345, ended_at: '2025-06-14T12:00:00Z',
      user: { username: id % 2 ? 'mrekk' : 'Accolibed', avatar_url: 'https://a.ppy.sh/7562902', country_code: 'AU' } }] });
  }
  m = p.match(/^\/api\/v2\/beatmaps\/(\d+)$/);
  if (m) { const s = SETS.find((x) => x.beatmaps.some((b) => b.id === Number(m[1]))); return s ? json({ id: Number(m[1]), beatmapset_id: s.id }) : json({ error: 'nf' }, 404); }
  m = p.match(/^\/api\/v2\/beatmapsets\/(-?\d+)$/);
  if (m) { const s = SETS.find((x) => String(x.id) === m[1]); return s ? json(s) : json({ error: 'nf' }, 404); }
  if (p === '/api/v2/beatmapsets/search') {
    const q = (url.searchParams.get('q') || '').toLowerCase().split(/\s+/);
    const hit = SETS.filter((s) => q.every((w) => `${s.artist} ${s.title} ${s.creator}`.toLowerCase().includes(w)));
    return json({ beatmapsets: hit });
  }
  json({ error: 'not mocked ' + p }, 404);
}

// ---------- Vercel-style function runner ----------
function wrapRes(res) {
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); return res; };
  res.send = (b) => { res.end(b); return res; };
  res.redirect = (c, loc) => { if (typeof c === 'string') [c, loc] = [302, c]; res.writeHead(c, { Location: loc }); res.end(); return res; };
  return res;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.otf': 'font/otf', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, ORIGIN);
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks).toString();
  try {
    if (MOCK && url.pathname === '/__redis/pipeline') {
      const out = JSON.parse(body).map((c) => { const r = redis(c); return r && r.error ? r : { result: r }; });
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(out));
    }
    if (MOCK && url.pathname.startsWith('/__osu')) return mockOsu(req, res, url, body);
    if (MOCK && url.pathname.startsWith('/__media')) {
      const m = url.pathname.match(/(?:preview|beatmaps)\/(-?\d+)(?:\.mp3|\/covers\/fullsize\.jpg)$/);
      const f = m && path.join(ROOT, 'dev/fixtures/media', `${m[1]}${url.pathname.endsWith('.mp3') ? '.mp3' : '.jpg'}`);
      if (f && fs.existsSync(f)) { res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] }); return res.end(fs.readFileSync(f)); }
      res.writeHead(404); return res.end();
    }
    if (url.pathname.startsWith('/api/')) {
      const file = path.join(ROOT, url.pathname.replace(/\/$/, '') + '.js');
      if (!fs.existsSync(file)) { res.writeHead(404); return res.end('no function'); }
      const mod = await import(pathToFileURL(file).href + (process.env.HOT ? `?t=${Date.now()}` : ''));
      req.query = Object.fromEntries(url.searchParams);
      req.body = body ? (() => { try { return JSON.parse(body); } catch { return body; } })() : undefined;
      return await mod.default(req, wrapRes(res));
    }
    let p = url.pathname === '/' ? '/index.html' : url.pathname;
    if (!path.extname(p)) p += '.html'; // cleanUrls
    const f = path.join(ROOT, 'public', p);
    if (!f.startsWith(path.join(ROOT, 'public')) || !fs.existsSync(f)) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    res.end(fs.readFileSync(f));
  } catch (e) {
    console.error(e); res.writeHead(500); res.end(String(e));
  }
}).listen(PORT, () => console.log(`Guess the Beatmap dev server on ${ORIGIN}${MOCK ? ' (mock Redis + osu!)' : ''}`));

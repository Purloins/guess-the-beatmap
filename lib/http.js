import crypto from 'node:crypto';

const SECRET = () => {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error('SESSION_SECRET must be set (16+ characters)');
  return s;
};

export function baseUrl(req) {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}`;
}

export function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function setCookie(res, name, value, { maxAge = 60 * 60 * 24 * 7, secure = true } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (secure && process.env.INSECURE_COOKIES !== '1') parts.push('Secure');
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', [...(Array.isArray(prev) ? prev : prev ? [prev] : []), parts.join('; ')]);
}

const b64 = (s) => Buffer.from(s).toString('base64url');
const sign = (data) => crypto.createHmac('sha256', SECRET()).update(data).digest('base64url');

export function makeSession(user) {
  const data = b64(JSON.stringify({ ...user, exp: Date.now() + 1000 * 60 * 60 * 24 * 7 }));
  return `${data}.${sign(data)}`;
}

export function getSession(req) {
  const raw = parseCookies(req).gtb_s;
  if (!raw) return null;
  const [data, sig] = raw.split('.');
  if (!data || !sig) return null;
  const expect = sign(data);
  if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  const s = JSON.parse(Buffer.from(data, 'base64url').toString());
  return s.exp > Date.now() ? s : null;
}

export function hostIds() {
  return (process.env.HOST_OSU_IDS || '19350047').split(',').map((x) => x.trim()).filter(Boolean);
}

export function isHost(session) {
  return !!session && hostIds().includes(String(session.id));
}

export function requireHost(req, res) {
  const s = getSession(req);
  if (!isHost(s)) {
    res.status(s ? 403 : 401).json({ error: s ? 'Only hosts can do this' : 'Sign in first' });
    return null;
  }
  return s;
}

export async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const s = Buffer.concat(chunks).toString();
  return s ? JSON.parse(s) : {};
}

// Wrap a handler so errors come back as JSON instead of a silent 500.
export function handler(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) res.status(500).json({ error: e.message || String(e) });
    }
  };
}

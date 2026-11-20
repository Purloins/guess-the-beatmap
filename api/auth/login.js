import crypto from 'node:crypto';
import { baseUrl, setCookie, handler } from '../../lib/http.js';

export default handler(async (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  const next = typeof req.query.next === 'string' && req.query.next.startsWith('/') ? req.query.next : '/';
  setCookie(res, 'gtb_oauth', `${state}|${next}`, { maxAge: 600 });
  const p = new URLSearchParams({
    client_id: process.env.OSU_CLIENT_ID,
    redirect_uri: `${baseUrl(req)}/api/auth/callback`,
    response_type: 'code',
    scope: 'identify',
    state,
  });
  res.redirect(302, `${process.env.OSU_BASE || 'https://osu.ppy.sh'}/oauth/authorize?${p}`);
});

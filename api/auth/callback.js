import { baseUrl, parseCookies, setCookie, makeSession, handler } from '../../lib/http.js';
import { cmd, P } from '../../lib/redis.js';

const OSU = process.env.OSU_BASE || 'https://osu.ppy.sh';

export default handler(async (req, res) => {
  const [state, next = '/'] = (parseCookies(req).gtb_oauth || '').split('|');
  if (!req.query.code || !state || req.query.state !== state) {
    return res.redirect(302, '/?error=login');
  }
  const tok = await fetch(`${OSU}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: Number(process.env.OSU_CLIENT_ID),
      client_secret: process.env.OSU_CLIENT_SECRET,
      code: req.query.code,
      grant_type: 'authorization_code',
      redirect_uri: `${baseUrl(req)}/api/auth/callback`,
    }),
  });
  if (!tok.ok) return res.redirect(302, '/?error=token');
  const { access_token } = await tok.json();
  const me = await (await fetch(`${OSU}/api/v2/me/osu`, { headers: { Authorization: `Bearer ${access_token}`, Accept: 'application/json' } })).json();
  const user = { id: String(me.id), u: me.username, a: me.avatar_url, c: me.country_code };
  await cmd('HSET', P + 'players', user.id, JSON.stringify({ u: user.u, a: user.a, c: user.c }));
  setCookie(res, 'gtb_s', makeSession(user));
  setCookie(res, 'gtb_oauth', '', { maxAge: 0 });
  res.redirect(302, next);
});

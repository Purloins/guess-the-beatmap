import { setCookie, handler } from '../../lib/http.js';

export default handler(async (req, res) => {
  setCookie(res, 'gtb_s', '', { maxAge: 0 });
  res.redirect(302, '/');
});

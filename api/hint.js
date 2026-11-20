import { requireHost, handler } from '../lib/http.js';
import { getQuestions } from '../lib/game.js';
import { sanitizedOsu } from '../lib/osu.js';

// Streams the current question's background or audio preview without exposing the beatmap ID in the URL.
// Host-only, so nobody can look the answer up from the page source.
export default handler(async (req, res) => {
  if (!requireHost(req, res)) return;
  const qs = await getQuestions();
  const q = qs[Number(req.query.q)];
  if (!q) return res.status(404).json({ error: 'No such question' });
  if (req.query.kind === 'osu') {
    if (!q.beatmapId) return res.status(404).json({ error: 'This question has no difficulty ID' });
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'private, max-age=600');
    return res.status(200).send(await sanitizedOsu(q.beatmapId));
  }
  const PREVIEW = process.env.OSU_PREVIEW_BASE || 'https://b.ppy.sh';
  const ASSETS = process.env.OSU_ASSETS_BASE || 'https://assets.ppy.sh';
  const urls = req.query.kind === 'audio'
    ? [`${PREVIEW}/preview/${q.setId}.mp3`]
    : [`${ASSETS}/beatmaps/${q.setId}/covers/fullsize.jpg`, `${ASSETS}/beatmaps/${q.setId}/covers/cover@2x.jpg`];
  for (const u of urls) {
    const r = await fetch(u);
    if (!r.ok) continue;
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', r.headers.get('content-type') || (req.query.kind === 'audio' ? 'audio/mpeg' : 'image/jpeg'));
    res.setHeader('Cache-Control', 'private, max-age=600');
    return res.status(200).send(buf);
  }
  res.status(404).json({ error: 'Media not found on osu!' });
});

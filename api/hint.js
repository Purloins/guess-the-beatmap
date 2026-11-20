import { requireHost, handler } from '../lib/http.js';
import { getQuestions } from '../lib/game.js';
import { sanitizedOsu, api, toQuestion } from '../lib/osu.js';
import { setJSON } from '../lib/redis.js';
import { songSegment } from '../lib/audio.js';

// Streams the current question's background or audio preview without exposing the beatmap ID in the URL.
// Host-only, so nobody can look the answer up from the page source.
export default handler(async (req, res) => {
  if (!requireHost(req, res)) return;
  const qs = await getQuestions();
  const q = qs[Number(req.query.q)];
  if (!q) return res.status(404).json({ error: 'No such question' });
  if (req.query.kind === 'osu') {
    if (!q.beatmapId) {
      // Maps added by an older version have no difficulty ID: look it up once and save it
      const set = await api(`/beatmapsets/${q.setId}`);
      if (!set) return res.status(404).json({ error: 'Map not found on osu!' });
      const fresh = await toQuestion(set);
      Object.assign(q, { beatmapId: fresh.beatmapId, maxCombo: q.maxCombo || fresh.maxCombo, score: q.score || fresh.score });
      await setJSON('questions', qs);
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'private, max-age=600');
    return res.status(200).send(await sanitizedOsu(q.beatmapId));
  }
  if (req.query.kind === 'audio') {
    // Prefer the real song (cut at a known map time, so gameplay can be synced to it); fall back to osu!'s 10s preview.
    try {
      const seg = await songSegment(q, Number(req.query.len) || 60000);
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('X-Audio-Kind', 'full');
      res.setHeader('X-Audio-Start', String(Math.round(seg.start)));
      res.setHeader('Cache-Control', 'private, max-age=600');
      return res.status(200).send(Buffer.from(seg.data));
    } catch (e) {
      res.setHeader('X-Audio-Kind', 'preview');
      res.setHeader('X-Audio-Note', String(e.message).slice(0, 120));
    }
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

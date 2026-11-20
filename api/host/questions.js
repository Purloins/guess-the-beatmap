import { requireHost, readBody, handler } from '../../lib/http.js';
import { getQuestions, getState } from '../../lib/game.js';
import { setJSON } from '../../lib/redis.js';
import { resolveLine } from '../../lib/osu.js';

// GET: list. POST {lines, mode:'append'|'replace'}: look maps up on osu!. PUT {questions}: save an edited list.
export default handler(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!requireHost(req, res)) return;
  if (req.method === 'GET') return res.json({ questions: await getQuestions() });
  const body = await readBody(req);
  if (req.method === 'PUT') {
    const state = await getState();
    if (state.phase !== 'lobby' && state.phase !== 'ended') return res.status(409).json({ error: 'Reset the game before editing the map list' });
    await setJSON('questions', body.questions || []);
    return res.json({ questions: body.questions || [] });
  }
  if (req.method === 'POST') {
    const lines = String(body.lines || '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 60);
    const found = [], errors = [];
    for (const line of lines) {
      try {
        const q = await resolveLine(line);
        if (q) found.push(q);
      } catch (e) {
        errors.push(e.message);
      }
    }
    const existing = body.mode === 'replace' ? [] : await getQuestions();
    const seen = new Set(existing.map((q) => q.setId));
    const merged = [...existing, ...found.filter((q) => !seen.has(q.setId) && seen.add(q.setId))];
    await setJSON('questions', merged);
    return res.json({ questions: merged, errors, added: found.length });
  }
  res.status(405).json({ error: 'Method not allowed' });
});

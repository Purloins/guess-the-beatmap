import { getSession, readBody, handler } from '../lib/http.js';
import { getState, getQuestions, points, pipeline, cmd, P } from '../lib/game.js';
import { check } from '../lib/match.js';

export default handler(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const s = getSession(req);
  if (!s) return res.status(401).json({ error: 'Sign in with osu! first' });
  const { guess = '', qIndex } = await readBody(req);
  const now = Date.now();
  const [state, qs] = await Promise.all([getState(), getQuestions()]);
  const q = qs[state.qIndex];
  if (state.phase !== 'question' || !q || qIndex !== state.qIndex) return res.status(409).json({ error: 'This question is closed' });
  if (now < state.startsAt) return res.status(409).json({ error: 'Not started yet' });
  if (now > state.deadline + 400) return res.status(409).json({ error: "Time's up!" }); // small grace for network lag
  const key = P + `ans:${state.qIndex}`;
  const prev = JSON.parse((await cmd('HGET', key, s.id)) || 'null') || { ok: false, guesses: [] };
  const max = state.settings?.maxGuesses ?? 3;
  if (prev.ok) return res.json({ result: 'done', answer: prev });
  if (prev.guesses.length >= max) return res.json({ result: 'out', answer: prev });
  const g = String(guess).slice(0, 120);
  const result = check(g, q);
  const rec = { ...prev, guesses: [...prev.guesses, g] };
  if (result === 'correct') {
    // HSETNX guards against double-scoring if two requests race
    const won = await cmd('HSETNX', P + `won:${state.qIndex}`, s.id, now);
    if (!Number(won)) return res.json({ result: 'done', answer: prev });
    rec.ok = true;
    rec.t = now - state.startsAt;
    rec.pts = points(state, Math.min(now, state.deadline));
    await pipeline([
      ['HSET', key, s.id, JSON.stringify(rec)],
      ['ZINCRBY', P + 'scores', rec.pts, s.id],
      ['HSET', P + 'players', s.id, JSON.stringify({ u: s.u, a: s.a, c: s.c })],
    ]);
  } else {
    await pipeline([
      ['HSET', key, s.id, JSON.stringify(rec)],
      ['ZINCRBY', P + 'scores', 0, s.id], // appear on the leaderboard even with 0
      ['HSET', P + 'players', s.id, JSON.stringify({ u: s.u, a: s.a, c: s.c })],
    ]);
  }
  res.json({ result, answer: rec, left: Math.max(0, max - rec.guesses.length) });
});

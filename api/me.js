import { getSession, isHost, handler } from '../lib/http.js';
import { pipeline, P, getState } from '../lib/game.js';

// The signed-in player's own status: score, rank, and how they did on the current question.
export default handler(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const s = getSession(req);
  if (!s) return res.json({ user: null });
  const state = await getState();
  const q = state.qIndex;
  const [score, rank, total, ans] = await pipeline([
    ['ZSCORE', P + 'scores', s.id],
    ['ZREVRANK', P + 'scores', s.id],
    ['ZCARD', P + 'scores'],
    ['HGET', P + `ans:${q}`, s.id],
  ]);
  res.json({
    user: { id: s.id, username: s.u, avatar: s.a },
    host: isHost(s),
    score: Number(score || 0),
    rank: rank == null ? null : Number(rank) + 1,
    ranked: Number(total || 0),
    qIndex: q,
    answer: ans ? JSON.parse(ans) : null,
  });
});

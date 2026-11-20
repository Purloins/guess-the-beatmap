import { requireHost, handler } from '../../lib/http.js';
import { getState, getQuestions, leaderboard, titleShape, pipeline, P } from '../../lib/game.js';

// Everything the projector screen and host panel need (host-only: includes the answer).
export default handler(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!requireHost(req, res)) return;
  const [state, qs] = await Promise.all([getState(), getQuestions()]);
  const i = state.qIndex;
  const [answers, playersRaw] = await pipeline([
    ['HGETALL', P + `ans:${Math.max(0, i)}`],
    ['HGETALL', P + 'players'],
  ]);
  const players = {};
  for (let k = 0; k < (playersRaw || []).length; k += 2) players[playersRaw[k]] = JSON.parse(playersRaw[k + 1]);
  const correct = [];
  let answered = 0;
  if (i >= 0) {
    for (let k = 0; k < (answers || []).length; k += 2) {
      const a = JSON.parse(answers[k + 1]);
      answered++;
      if (a.ok) correct.push({ id: answers[k], username: players[answers[k]]?.u || answers[k], avatar: players[answers[k]]?.a, t: a.t, pts: a.pts });
    }
  }
  correct.sort((a, b) => a.t - b.t);
  const q = qs[i];
  res.json({
    state,
    serverNow: Date.now(),
    total: qs.length,
    question: q ? { ...q, shape: titleShape(q.title) } : null,
    answered,
    correct,
    players: Object.entries(players).map(([id, p]) => ({ id, username: p.u, avatar: p.a })),
    leaderboard: await leaderboard(10),
  });
});

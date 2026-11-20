import { handler } from '../lib/http.js';
import { getState, getQuestions, leaderboard, cmd, P } from '../lib/game.js';

// Public game state that every phone polls. Cached at the CDN for 1s so 100+ phones cost ~1 Redis read per second.
export default handler(async (req, res) => {
  const [state, qs, players] = await Promise.all([getState(), getQuestions(), cmd('HLEN', P + 'players')]);
  const out = {
    phase: state.phase,
    qIndex: state.qIndex,
    total: qs.length,
    startsAt: state.startsAt || null,
    deadline: state.deadline || null,
    settings: state.settings,
    players: Number(players || 0),
    serverNow: Date.now(),
  };
  const q = qs[state.qIndex];
  if (q) out.type = q.type || 'audio';
  if (q && ['reveal', 'leaderboard', 'ended'].includes(state.phase)) {
    out.reveal = { title: q.title, artist: q.artist, creator: q.creator, version: q.version, cover: `https://assets.ppy.sh/beatmaps/${q.setId}/covers/card@2x.jpg` };
  }
  if (['leaderboard', 'ended'].includes(state.phase)) out.leaderboard = await leaderboard(10);
  res.setHeader('Cache-Control', 'public, s-maxage=1, stale-while-revalidate=1');
  res.json(out);
});

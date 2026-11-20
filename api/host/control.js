import { requireHost, readBody, handler } from '../../lib/http.js';
import { getState, setState, getQuestions, resetGame, DEFAULTS } from '../../lib/game.js';

// Host actions: start / next / reveal / leaderboard / end / reset / settings / jump
export default handler(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!requireHost(req, res)) return;
  const { action, settings, index } = await readBody(req);
  const state = await getState();
  const qs = await getQuestions();
  const st = { ...DEFAULTS, ...(state.settings || {}) };
  const now = Date.now();
  const open = (i) => {
    const startsAt = now + st.countdown * 1000;
    return { ...state, settings: st, phase: 'question', qIndex: i, startsAt, deadline: startsAt + st.duration * 1000 };
  };
  let next = state;
  switch (action) {
    case 'start':
    case 'next': {
      const i = state.qIndex + 1;
      if (!qs.length) return res.status(400).json({ error: 'Add some maps first' });
      next = i >= qs.length ? { ...state, phase: 'ended' } : open(i);
      break;
    }
    case 'jump':
      if (!(index >= 0 && index < qs.length)) return res.status(400).json({ error: 'No such question' });
      next = open(index);
      break;
    case 'reveal':
      if (state.phase !== 'question') return res.status(409).json({ error: 'No question is running' });
      next = { ...state, phase: 'reveal', deadline: Math.min(state.deadline, now) };
      break;
    case 'leaderboard':
      next = { ...state, phase: 'leaderboard' };
      break;
    case 'end':
      next = { ...state, phase: 'ended' };
      break;
    case 'reset':
      await resetGame();
      return res.json({ state: await getState() });
    case 'settings': {
      const s = { ...st };
      for (const k of ['duration', 'countdown', 'maxGuesses', 'maxPoints', 'minPoints']) if (settings?.[k] != null) s[k] = Number(settings[k]);
      if (Array.isArray(settings?.stages)) s.stages = settings.stages.map(Number).sort((a, b) => a - b);
      next = { ...state, settings: s };
      break;
    }
    default:
      return res.status(400).json({ error: `Unknown action ${action}` });
  }
  await setState(next);
  res.json({ state: next });
});

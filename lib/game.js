// Game state and scoring.
import { cmd, pipeline, getJSON, setJSON, P } from './redis.js';

export const DEFAULTS = {
  duration: 45, // seconds to answer
  stages: [0, 15, 30], // when each hint stage starts (seconds)
  countdown: 3, // "Question N" card before the timer starts
  maxGuesses: 3,
  maxPoints: 1000,
  minPoints: 400,
};

export async function getState() {
  return (await getJSON('state')) || { phase: 'lobby', qIndex: -1, settings: DEFAULTS };
}

export const setState = (s) => setJSON('state', s);
export const getQuestions = async () => (await getJSON('questions')) || [];

// Points fall linearly from maxPoints at the start to minPoints at the deadline.
export function points(state, at) {
  const st = state.settings || DEFAULTS;
  const f = Math.min(1, Math.max(0, (at - state.startsAt) / (state.deadline - state.startsAt)));
  return Math.round(st.maxPoints - (st.maxPoints - st.minPoints) * f);
}

export function stageAt(state, now) {
  if (state.phase !== 'question' || now < state.startsAt) return -1;
  const t = (now - state.startsAt) / 1000;
  const stages = (state.settings || DEFAULTS).stages;
  let k = 0;
  stages.forEach((s, i) => { if (t >= s) k = i; });
  return k;
}

// "H _ _ _ _ _ _ _ _   C _ _ _ _ _" style hint (first letter of each word)
export function titleShape(title) {
  return String(title)
    .split(/\s+/)
    .map((w) => [...w].map((ch, i) => (/[\p{L}\p{N}]/u.test(ch) ? (i === 0 ? ch : '_') : ch)).join('\u00a0')) // no line breaks inside a word
    .join('   ');
}

export async function leaderboard(n = 10) {
  const raw = await cmd('ZREVRANGE', P + 'scores', 0, n - 1, 'WITHSCORES');
  const ids = [];
  for (let i = 0; i < raw.length; i += 2) ids.push([raw[i], Number(raw[i + 1])]);
  if (!ids.length) return [];
  const prof = await cmd('HMGET', P + 'players', ...ids.map((x) => x[0]));
  return ids.map(([id, score], i) => {
    const p = prof[i] ? JSON.parse(prof[i]) : { u: id };
    return { id, username: p.u, avatar: p.a, score, rank: i + 1 };
  });
}

export async function resetGame() {
  const qs = await getQuestions();
  const keys = ['scores', 'players', ...qs.map((_, i) => `ans:${i}`), ...qs.map((_, i) => `won:${i}`)].map((k) => P + k);
  await pipeline([['DEL', ...keys]]);
  const prev = await getState();
  await setState({ phase: 'lobby', qIndex: -1, settings: prev.settings || DEFAULTS });
}

export { pipeline, cmd, P };

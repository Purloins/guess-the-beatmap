// Shared helpers for all pages.
export async function api(path, opts = {}) {
  const r = await fetch(path, {
    credentials: 'same-origin',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let j = {};
  try { j = await r.json(); } catch { /* empty */ }
  if (!r.ok) throw Object.assign(new Error(j.error || `Request failed (${r.status})`), { status: r.status });
  return j;
}

// Server clock offset. /api/state can be up to ~1s stale from the CDN, so keep the freshest (largest) estimate.
let offset = null;
export function syncClock(serverNow) {
  const est = serverNow - Date.now();
  if (offset == null || est > offset || Math.abs(est - offset) > 5000) offset = est;
}
export const now = () => Date.now() + (offset || 0);

export const $ = (s, el = document) => el.querySelector(s);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmtLen = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
export const fmtSec = (ms) => `${(ms / 1000).toFixed(1)}s`;

export function stageOf(state, t = now()) {
  if (state.phase !== 'question' || !state.startsAt || t < state.startsAt) return -1;
  const sec = (t - state.startsAt) / 1000;
  let k = 0;
  (state.settings?.stages || [0]).forEach((s, i) => { if (sec >= s) k = i; });
  return k;
}

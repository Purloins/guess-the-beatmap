// osu! API v2 helpers (client-credentials token for beatmap lookups).
import { cmd, P } from './redis.js';

const OSU = process.env.OSU_BASE || 'https://osu.ppy.sh';

export async function appToken() {
  const cached = await cmd('GET', P + 'apptoken');
  if (cached) return cached;
  const r = await fetch(`${OSU}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: Number(process.env.OSU_CLIENT_ID), client_secret: process.env.OSU_CLIENT_SECRET, grant_type: 'client_credentials', scope: 'public' }),
  });
  if (!r.ok) throw new Error(`osu! token request failed (${r.status}). Check OSU_CLIENT_ID / OSU_CLIENT_SECRET.`);
  const j = await r.json();
  await cmd('SET', P + 'apptoken', j.access_token, 'EX', Math.max(60, j.expires_in - 300));
  return j.access_token;
}

export async function api(path, extraHeaders = {}) {
  const r = await fetch(`${OSU}/api/v2${path}`, { headers: { Authorization: `Bearer ${await appToken()}`, Accept: 'application/json', ...extraHeaders } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`osu! API ${path} failed (${r.status})`);
  return r.json();
}

// The #1 leaderboard score on a difficulty, flattened to what the score screen shows.
// Handles both the legacy and the new (lazer) score formats.
export async function topScore(beatmapId) {
  try {
    const j = await api(`/beatmaps/${beatmapId}/scores?mode=osu&limit=1`);
    const s = j?.scores?.[0];
    if (!s) return null;
    const st = s.statistics || {};
    const mods = (s.mods || []).map((m) => (typeof m === 'string' ? m : m.acronym)).filter((m) => m && m !== 'CL');
    return {
      player: s.user?.username || '?',
      avatar: s.user?.avatar_url || '',
      country: s.user?.country_code || s.user?.country?.code || '',
      score: s.legacy_total_score || s.score || s.total_score || 0,
      accuracy: s.accuracy <= 1 ? s.accuracy * 100 : s.accuracy,
      combo: s.max_combo || 0,
      n300: st.great ?? st.count_300 ?? 0,
      n100: st.ok ?? st.count_100 ?? 0,
      n50: st.meh ?? st.count_50 ?? 0,
      miss: st.miss ?? st.count_miss ?? 0,
      grade: s.rank || '',
      mods,
      pp: s.pp ? Math.round(s.pp) : null,
      date: (s.ended_at || s.created_at || '').slice(0, 10),
    };
  } catch {
    return null;
  }
}

// Turn a beatmapset (from the API) into a quiz question. Uses the given difficulty, or the hardest osu!standard one.
export async function toQuestion(set, beatmapId = null) {
  const diffs = (set.beatmaps || []).filter((b) => b.mode === 'osu');
  const d = (beatmapId && diffs.find((b) => b.id === Number(beatmapId))) || diffs.sort((a, b) => b.difficulty_rating - a.difficulty_rating)[0] || (set.beatmaps || [])[0] || {};
  return {
    setId: set.id,
    beatmapId: d.id || null,
    type: 'audio',
    title: set.title,
    titleUnicode: set.title_unicode || set.title,
    artist: set.artist,
    artistUnicode: set.artist_unicode || set.artist,
    creator: set.creator,
    version: d.version || '',
    bpm: Math.round(d.bpm || set.bpm || 0),
    length: d.total_length || 0,
    sr: Math.round((d.difficulty_rating || 0) * 100) / 100,
    cs: d.cs ?? null,
    ar: d.ar ?? null,
    od: d.accuracy ?? null,
    maxCombo: d.max_combo || null,
    plays: set.play_count || 0,
    score: d.id ? await topScore(d.id) : null,
    aliases: [],
  };
}

// A line is either a beatmapset ID / URL, a beatmap (difficulty) URL, or search text.
export async function resolveLine(line) {
  const s = line.trim();
  if (!s) return null;
  // difficulty link: https://osu.ppy.sh/beatmapsets/123#osu/456 or /b/456 or /beatmaps/456
  let m = s.match(/#osu\/(\d+)/) || s.match(/\/b(?:eatmaps)?\/(\d+)/);
  if (m) {
    const b = await api(`/beatmaps/${m[1]}`);
    if (b) return toQuestion(await api(`/beatmapsets/${b.beatmapset_id}`), b.id);
  }
  m = s.match(/beatmapsets\/(\d+)/) || s.match(/^(\d+)$/);
  if (m) {
    const set = await api(`/beatmapsets/${m[1]}`);
    if (set) return toQuestion(set);
  }
  // Search: most-played ranked/loved set that matches the text
  const res = await api(`/beatmapsets/search?q=${encodeURIComponent(s)}&m=0&s=any&sort=plays_desc`);
  const set = res?.beatmapsets?.[0];
  if (!set) throw new Error(`No beatmap found for "${s}"`);
  return toQuestion((await api(`/beatmapsets/${set.id}`)) || set);
}

// Raw .osu file with everything that would give the answer away removed (title, artist, mapper, tags, background, audio file).
export async function sanitizedOsu(beatmapId) {
  const sources = [`${process.env.OSU_FILE_BASE || OSU}/osu/${beatmapId}`, `https://catboy.best/osu/${beatmapId}`];
  let text = null, why = '';
  for (const u of sources) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'guess-the-beatmap/1.0' } });
      const t = r.ok ? await r.text() : '';
      if (r.ok && t.includes('[HitObjects]')) { text = t; break; }
      why = `${new URL(u).host} answered ${r.status}`;
    } catch (e) { why = e.message; }
  }
  if (!text) throw new Error(`Could not download the .osu file (${why})`);
  const out = [];
  let sec = '';
  for (const line of text.split(/\r?\n/)) {
    if (/^\[.*\]$/.test(line.trim())) { sec = line.trim(); if (sec !== '[Metadata]' && sec !== '[Events]') out.push(line); continue; }
    if (sec === '[Metadata]' || sec === '[Events]') continue;
    if (sec === '[General]' && /^(AudioFilename|SkinPreference)\s*:/.test(line)) continue;
    out.push(line);
  }
  return out.join('\n');
}

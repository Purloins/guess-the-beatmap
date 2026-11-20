// Fuzzy title matching for typed answers.

export function norm(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // accents
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^\p{L}\p{N}]+/gu, ''); // drop spaces and punctuation, keep letters/digits in any script
}

// Every acceptable form of a title: full, without (TV Size)/[...] parts, without "feat." credits, unicode title, aliases.
export function variants(q) {
  const out = new Set();
  const add = (s) => { const n = norm(s); if (n.length) out.add(n); };
  for (const t of [q.title, q.titleUnicode, ...(q.aliases || [])]) {
    if (!t) continue;
    add(t);
    const noParen = t.replace(/\s*[\(\[\{（【].*?[\)\]\}）】]\s*/g, ' ').trim();
    add(noParen);
    const noFeat = noParen.replace(/\s+(feat\.?|ft\.?|featuring|with)\s.*$/i, '').trim();
    add(noFeat);
    const noTilde = noFeat.replace(/\s*[~～\-–—:]\s.*$/, '').trim(); // "Title ~subtitle~" / "Title - Subtitle"
    if (noTilde.length >= 3) add(noTilde);
    for (const v of [noFeat, noTilde]) {
      const noThe = v.replace(/^(the|a|an)\s+/i, '');
      if (noThe !== v && noThe.length >= 3) add(noThe);
    }
  }
  return [...out];
}

function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

const sim = (a, b) => 1 - lev(a, b) / Math.max(a.length, b.length);

// Returns 'correct' | 'close' | 'wrong'
export function check(guess, q) {
  const g = norm(guess);
  if (!g) return 'wrong';
  let best = 0;
  for (const v of variants(q)) {
    if (g === v) return 'correct';
    const s = sim(g, v);
    // Typos are forgiven on longer titles only; very short titles must be exact.
    const need = v.length <= 4 ? 1 : v.length <= 8 ? 0.84 : 0.8;
    if (s >= need) return 'correct';
    best = Math.max(best, s);
  }
  return best >= 0.6 ? 'close' : 'wrong';
}

// Minimal osu!standard autoplay renderer for <canvas>. No audio, no background: gameplay only.
// const r = createReplay(osuText); r.draw(ctx, width, height, timeMs); r.start = suggested start time.

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function parse(text) {
  const d = { general: {}, diff: {}, timing: [], colours: [], objects: [] };
  let sec = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;
    if (/^\[.*\]$/.test(line)) { sec = line.slice(1, -1); continue; }
    if (sec === 'General' || sec === 'Difficulty') {
      const i = line.indexOf(':');
      if (i > 0) d[sec === 'General' ? 'general' : 'diff'][line.slice(0, i).trim()] = line.slice(i + 1).trim();
    } else if (sec === 'TimingPoints') {
      const p = line.split(',');
      d.timing.push({ t: +p[0], bl: +p[1], meter: +(p[2] || 4), vol: +(p[5] || 100), unin: p.length < 7 || p[6] === '1', kiai: (+(p[7] || 0) & 1) === 1 });
    } else if (sec === 'Colours') {
      const [k, v] = line.split(':');
      if (k.trim().startsWith('Combo')) d.colours.push(v.split(',').map(Number));
    } else if (sec === 'HitObjects') d.objects.push(line.split(','));
  }
  return d;
}

function bezier(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1], pts[i]);
  const n = Math.max(8, Math.ceil(len / 3)), out = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    let q = pts.map((p) => [p[0], p[1]]);
    while (q.length > 1) q = q.slice(1).map((b, i) => [(1 - t) * q[i][0] + t * b[0], (1 - t) * q[i][1] + t * b[1]]);
    out.push(q[0]);
  }
  return out;
}

function perfect([a, b, c]) {
  const D = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(D) < 1e-6) return null;
  const sq = (p) => p[0] * p[0] + p[1] * p[1];
  const ux = (sq(a) * (b[1] - c[1]) + sq(b) * (c[1] - a[1]) + sq(c) * (a[1] - b[1])) / D;
  const uy = (sq(a) * (c[0] - b[0]) + sq(b) * (a[0] - c[0]) + sq(c) * (b[0] - a[0])) / D;
  const r = Math.hypot(a[0] - ux, a[1] - uy);
  const ang = (p) => Math.atan2(p[1] - uy, p[0] - ux);
  const norm = (x) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const a0 = ang(a), ccw = norm(ang(b) - a0) < norm(ang(c) - a0);
  const span = ccw ? norm(ang(c) - a0) : -norm(a0 - ang(c));
  const n = Math.max(8, Math.ceil((Math.abs(span) * r) / 3)), out = [];
  for (let k = 0; k <= n; k++) out.push([ux + r * Math.cos(a0 + (span * k) / n), uy + r * Math.sin(a0 + (span * k) / n)]);
  return out;
}

function catmull(pts) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || [2 * p2[0] - p1[0], 2 * p2[1] - p1[1]];
    for (let k = 0; k < 40; k++) {
      const t = k / 40, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((j) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)));
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function sliderPath(kind, pts, length) {
  let poly;
  if (kind === 'P' && pts.length === 3) poly = perfect(pts) || bezier(pts);
  else if (kind === 'L') poly = pts;
  else if (kind === 'C') poly = catmull(pts);
  else {
    poly = []; let seg = [pts[0]];
    for (const p of pts.slice(1)) {
      if (p[0] === seg[seg.length - 1][0] && p[1] === seg[seg.length - 1][1]) { poly.push(...bezier(seg)); seg = [p]; } else seg.push(p);
    }
    poly.push(...bezier(seg));
  }
  const out = [poly[0]]; let acc = 0;
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1], b = poly[i], dl = dist(a, b);
    if (!dl) continue;
    if (acc + dl >= length) { const f = (length - acc) / dl; out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]); acc = length; break; }
    out.push(b); acc += dl;
  }
  if (acc < length && out.length > 1) {
    const a = out[out.length - 2], b = out[out.length - 1], dl = dist(a, b) || 1, f = (length - acc) / dl;
    out[out.length - 1] = [b[0] + (b[0] - a[0]) * f, b[1] + (b[1] - a[1]) * f];
  }
  const cum = [0];
  for (let i = 1; i < out.length; i++) cum.push(cum[i - 1] + dist(out[i - 1], out[i]));
  return { path: out, cum };
}

function pointAt(o, s) {
  const { path, cum } = o;
  s = Math.max(0, Math.min(cum[cum.length - 1], s));
  let lo = 1, hi = cum.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < s) lo = m + 1; else hi = m; }
  const a = path[lo - 1], b = path[lo], f = (s - cum[lo - 1]) / ((cum[lo] - cum[lo - 1]) || 1);
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

export function createReplay(text) {
  const d = parse(text);
  const cs = +d.diff.CircleSize, ar = +(d.diff.ApproachRate ?? d.diff.OverallDifficulty), sm = +d.diff.SliderMultiplier || 1.4;
  const R = 54.4 - 4.48 * cs;
  const preempt = ar < 5 ? 1200 + (600 * (5 - ar)) / 5 : 1200 - (750 * (ar - 5)) / 5;
  const fadeIn = Math.min(preempt, ar < 5 ? 800 + (400 * (5 - ar)) / 5 : 800 - (500 * (ar - 5)) / 5) * 0.66;
  const unin = d.timing.filter((t) => t.unin);
  const beatAt = (t) => { let bl = unin[0]?.bl || 500; for (const u of unin) if (u.t <= t + 1) bl = u.bl; return bl; };
  const svAt = (t) => { let sv = 1; for (const p of d.timing) { if (p.t > t + 1) break; sv = p.unin ? 1 : p.bl < 0 ? -100 / p.bl : 1; } return Math.max(0.1, Math.min(10, sv)); };
  const cols = d.colours.length ? d.colours : [[255, 192, 0], [0, 202, 0], [18, 124, 255], [242, 24, 57]];
  const objs = [];
  let ci = 0, num = 0;
  d.objects.forEach((p, k) => {
    const typ = +p[3];
    const o = { x: +p[0], y: +p[1], t: +p[2], kind: typ & 8 ? 'spinner' : typ & 2 ? 'slider' : 'circle', hs: +p[4] || 0 };
    if (k === 0) { ci = 0; num = 0; } else if (typ & 4) { ci = (ci + 1 + ((typ >> 4) & 7)) % cols.length; num = 0; }
    if (o.kind !== 'spinner') num++;
    o.num = num; o.col = cols[ci]; o.end = o.t;
    if (o.kind === 'slider') {
      const parts = p[5].split('|');
      const pts = [[o.x, o.y], ...parts.slice(1).map((q) => q.split(':').map(Number))];
      o.slides = +p[6];
      o.edges = p[8] ? p[8].split('|').map(Number) : null;
      Object.assign(o, sliderPath(parts[0], pts, +p[7]));
      o.span = (+p[7] / (sm * 100 * svAt(o.t))) * beatAt(o.t);
      o.end = o.t + o.span * o.slides;
    } else if (o.kind === 'spinner') { o.end = +p[5]; o.x = 256; o.y = 192; }
    o.stack = 0;
    objs.push(o);
  });
  // stacking (osu!stable algorithm, simplified)
  const thresh = preempt * (+d.general.StackLeniency || 0.7);
  const endPos = (o) => (o.kind === 'slider' ? (o.slides % 2 ? o.path[o.path.length - 1] : o.path[0]) : [o.x, o.y]);
  for (let i = objs.length - 1; i > 0; i--) {
    let oi = objs[i];
    if (oi.stack || oi.kind === 'spinner') continue;
    for (let n = i - 1; n >= 0; n--) {
      const on = objs[n];
      if (on.kind === 'spinner') continue;
      if (oi.t - (oi.kind === 'circle' ? on.end : on.t) > thresh) break;
      if (oi.kind === 'circle' && on.kind === 'slider' && dist(endPos(on), [oi.x, oi.y]) < 3) {
        const off = oi.stack - on.stack + 1;
        for (let j = n + 1; j <= i; j++) if (dist(endPos(on), [objs[j].x, objs[j].y]) < 3) objs[j].stack -= off;
        break;
      }
      if (dist([on.x, on.y], [oi.x, oi.y]) < 3) { on.stack = oi.stack + 1; oi = on; }
    }
  }
  for (const o of objs) {
    const off = (o.stack * R) / 10;
    o.sx = o.x - off; o.sy = o.y - off;
    if (o.path) { o.path = o.path.map(([a, b]) => [a - off, b - off]); }
  }
  // hitsound events: { t, hs (bit flags: 2 whistle, 4 finish, 8 clap), tick, vol }
  const volAt = (t) => { let v = 100; for (const p of d.timing) { if (p.t > t + 1) break; v = p.vol; } return v / 100; };
  const tickRate = +d.diff.SliderTickRate || 1;
  const events = [];
  for (const o of objs) {
    if (o.kind === 'circle') events.push({ t: o.t, hs: o.hs });
    else if (o.kind === 'spinner') events.push({ t: o.end, hs: o.hs });
    else {
      for (let e = 0; e <= o.slides; e++) events.push({ t: o.t + e * o.span, hs: o.edges ? o.edges[e] || 0 : o.hs });
      const L = o.cum[o.cum.length - 1], v = L / o.span, step = (beatAt(o.t) / tickRate) * v;
      if (step > 0) for (let sp = 0; sp < o.slides; sp++) for (let s = step; s < L - 10; s += step) events.push({ t: o.t + sp * o.span + (sp % 2 ? L - s : s) / v, tick: true });
    }
  }
  events.forEach((e) => { e.vol = volAt(e.t); });
  events.sort((a, b) => a.t - b.t);
  const first = objs[0]?.t || 0, last = Math.max(...objs.map((o) => o.end));
  const kiai = d.timing.find((t) => t.kiai && t.t > first + 8000);
  const start = Math.max(first - 500, (kiai ? kiai.t : first + (last - first) * 0.35) - 1500);

  const posAt = (o, t) => {
    if (o.kind === 'spinner') { const a = (t - o.t) * 0.05; return [256 + 50 * Math.cos(a), 192 + 50 * Math.sin(a)]; }
    if (o.kind === 'slider') {
      const prog = Math.max(0, (t - o.t) / o.span), rep = Math.min(o.slides - 1, Math.floor(prog));
      let f = Math.min(1, prog - rep); if (rep % 2) f = 1 - f;
      return pointAt(o, f * o.cum[o.cum.length - 1]);
    }
    return [o.sx, o.sy];
  };
  const startPos = (o) => (o.kind === 'spinner' ? [306, 192] : [o.sx, o.sy]);
  const endPosAt = (o) => posAt(o, o.end);
  // autoplay cursor: follow objects, ease between them
  function cursor(t) {
    let lo = 0, hi = objs.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (objs[m].t <= t) lo = m; else hi = m - 1; }
    const o = objs[lo];
    if (t < o.t) return startPos(o);
    if (t <= o.end) return posAt(o, t);
    const nx = objs[lo + 1];
    if (!nx) return endPosAt(o);
    const a = endPosAt(o), b = startPos(nx), ms = Math.max(o.end, nx.t - 450);
    if (t < ms) return a;
    const f = 0.5 - 0.5 * Math.cos((Math.PI * (t - ms)) / Math.max(1, nx.t - ms));
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  }

  function draw(ctx, W, H, t) {
    const scale = (H * 0.8) / 384, ox = (W - 512 * scale) / 2, oy = (H - 384 * scale) / 2 + H * 0.02;
    const P = (x, y) => [ox + x * scale, oy + y * scale];
    const r = R * scale;
    const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a))})`;
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.font = `700 ${Math.round(r * 0.8)}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const vis = objs.filter((o) => o.t - preempt <= t && t <= o.end + 260);
    for (let i = vis.length - 1; i >= 0; i--) {
      const o = vis[i];
      const alpha = Math.max(0, Math.min(1, (t - (o.t - preempt)) / fadeIn));
      if (o.kind === 'spinner') {
        if (t < o.t - 200) continue;
        const al = Math.min(1, (t - (o.t - 200)) / 200, (o.end + 250 - t) / 250);
        const [cx, cy] = P(256, 192), prog = Math.max(0, Math.min(1, (t - o.t) / Math.max(1, o.end - o.t)));
        ctx.lineWidth = 4 * scale; ctx.strokeStyle = rgba([255, 255, 255], al * 0.9);
        ctx.beginPath(); ctx.arc(cx, cy, 180 * scale, 0, 7); ctx.stroke();
        ctx.strokeStyle = rgba([255, 214, 107], al); ctx.lineWidth = 5 * scale;
        ctx.beginPath(); ctx.arc(cx, cy, 180 * scale * (1 - prog) + 6, 0, 7); ctx.stroke();
        continue;
      }
      const [x, y] = P(o.sx, o.sy);
      if (o.kind === 'slider') {
        const bal = t <= o.end ? alpha : Math.max(0, 1 - (t - o.end) / 240);
        if (bal > 0) {
          ctx.beginPath();
          o.path.forEach(([a, b], k) => { const [sx, sy] = P(a, b); k ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); });
          ctx.lineWidth = r * 2; ctx.strokeStyle = rgba([255, 255, 255], bal * 0.95); ctx.stroke();
          ctx.lineWidth = r * 1.72; ctx.strokeStyle = rgba([22, 22, 30], bal); ctx.stroke();
          ctx.lineWidth = r * 1.72; ctx.strokeStyle = rgba(o.col, bal * 0.3); ctx.stroke();
          // reverse arrow at the next turn
          const done = t > o.t ? (t - o.t) / o.span : 0;
          for (let rep = 1; rep < o.slides; rep++) {
            if (done >= rep) continue;
            const atEnd = rep % 2 === 1, L = o.cum[o.cum.length - 1];
            const [ex, ey] = P(...(atEnd ? pointAt(o, L) : pointAt(o, 0))), [nx, ny] = P(...(atEnd ? pointAt(o, L - 8) : pointAt(o, 8)));
            const ang = Math.atan2(ny - ey, nx - ex);
            ctx.save(); ctx.translate(ex, ey); ctx.rotate(ang); ctx.strokeStyle = rgba([255, 255, 255], bal); ctx.lineWidth = r * 0.16;
            ctx.beginPath(); ctx.moveTo(-r * 0.25, -r * 0.4); ctx.lineTo(r * 0.45, 0); ctx.lineTo(-r * 0.25, r * 0.4); ctx.stroke(); ctx.restore();
            break;
          }
        }
        if (o.t <= t && t <= o.end) {
          const [bx, by] = P(...posAt(o, t));
          ctx.lineWidth = r * 0.1; ctx.strokeStyle = rgba([255, 255, 255], 0.8); ctx.beginPath(); ctx.arc(bx, by, r * 2, 0, 7); ctx.stroke();
          ctx.fillStyle = rgba(o.col, 1); ctx.beginPath(); ctx.arc(bx, by, r * 0.8, 0, 7); ctx.fill();
          ctx.lineWidth = r * 0.12; ctx.strokeStyle = '#fff'; ctx.stroke();
        }
      }
      if (t < o.t) {
        circle(x, y, o.col, alpha, 1, o.num);
        ctx.lineWidth = r * 0.1; ctx.strokeStyle = rgba(o.col, alpha);
        ctx.beginPath(); ctx.arc(x, y, r * (1 + (3 * (o.t - t)) / preempt) * 0.95, 0, 7); ctx.stroke();
      } else if (t < o.t + 240) {
        const k = (t - o.t) / 240;
        circle(x, y, o.col, (1 - k) * 0.9, 1 + 0.4 * k, null);
      }
    }
    function circle(x, y, col, a, sc, n) {
      const rr = r * sc;
      ctx.fillStyle = rgba([0, 0, 0], a * 0.5); ctx.beginPath(); ctx.arc(x, y, rr * 0.93, 0, 7); ctx.fill();
      ctx.fillStyle = rgba(col, a); ctx.beginPath(); ctx.arc(x, y, rr * 0.86, 0, 7); ctx.fill();
      ctx.lineWidth = rr * 0.12; ctx.strokeStyle = rgba([255, 255, 255], a); ctx.beginPath(); ctx.arc(x, y, rr * 0.88, 0, 7); ctx.stroke();
      if (n != null) { ctx.fillStyle = rgba([255, 255, 255], a); ctx.fillText(String(n), x, y + rr * 0.04); }
    }
    // cursor with trail
    for (let k = 9; k >= 1; k--) {
      const [qx, qy] = P(...cursor(t - k * 9));
      ctx.fillStyle = `rgba(255,190,120,${0.4 * (1 - k / 10)})`; ctx.beginPath(); ctx.arc(qx, qy, 11 * scale * (1 - k / 12), 0, 7); ctx.fill();
    }
    const [cx, cy] = P(...cursor(t));
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, cy, 15 * scale, 0, 7); ctx.fill();
    ctx.fillStyle = '#ffaa50'; ctx.beginPath(); ctx.arc(cx, cy, 12 * scale, 0, 7); ctx.fill();
    ctx.restore();
  }

  const preview = +d.general.PreviewTime >= 0 ? +d.general.PreviewTime : null; // where the 10s osu! preview audio starts
  return { draw, start, first, last, events, preview, objects: objs.length };
}

// Full-song audio: download the .osz from a beatmap mirror, pull out the song, and cut an MP3 segment
// at a known map time (frame-accurate), so the projector can sync gameplay to it exactly.
import zlib from 'node:zlib';

const MIRRORS = (id) => [
  `${process.env.OSZ_MIRROR_BASE || 'https://catboy.best'}/d/${id}n`, // n = without video
  `https://api.nerinyan.moe/d/${id}?noVideo=true`,
];

// --- minimal ZIP reader (stored + deflate) ---
function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    files[name.toLowerCase()] = () => {
      const ln = buf.readUInt16LE(local + 26), lx = buf.readUInt16LE(local + 28);
      const data = buf.subarray(local + 30 + ln + lx, local + 30 + ln + lx + csize);
      return method === 0 ? data : zlib.inflateRawSync(data);
    };
    p += 46 + nlen + xlen + clen;
  }
  return files;
}

// --- MP3 frame walker ---
const BR = { 1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], 2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] };
const SR = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

function frameAt(b, i) {
  if (i + 4 > b.length || b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return null;
  const ver = (b[i + 1] >> 3) & 3, layer = (b[i + 1] >> 1) & 3;
  if (ver === 1 || layer !== 1) return null; // Layer III only
  const bri = b[i + 2] >> 4, sri = (b[i + 2] >> 2) & 3, pad = (b[i + 2] >> 1) & 1;
  if (bri === 0 || bri === 15 || sri === 3) return null;
  const sr = SR[ver][sri], kbps = BR[ver === 3 ? 1 : 2][bri];
  const spf = ver === 3 ? 1152 : 576;
  const len = Math.floor(((spf / 8) * kbps * 1000) / sr) + pad;
  // main_data_begin: how many bytes this frame borrows from earlier frames (0 = decodable on its own)
  const s = i + 4 + ((b[i + 1] & 1) ? 0 : 2);
  const mdb = ver === 3 ? (b[s] << 1) | (b[s + 1] >> 7) : b[s];
  return { len, dur: (spf * 1000) / sr, mdb };
}

// Returns { data, start } where start is the song time (ms) of the first frame kept.
export function cutMp3(b, fromMs, lenMs, maxBytes = 4_000_000) {
  let i = 0;
  if (b.toString('latin1', 0, 3) === 'ID3') i = 10 + ((b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9]);
  // resync to the first real frame (two consecutive valid headers)
  while (i < b.length - 4) { const f = frameAt(b, i); if (f && frameAt(b, i + f.len)) break; i++; }
  // Players skip a leading Xing/Info frame (no audio) and trim the LAME encoder delay, so song time 0 is later than
  // the first frame. Shift our clock to match, otherwise everything would be ~50ms early.
  let t = 0;
  const f0 = frameAt(b, i);
  if (f0) {
    const head = b.subarray(i, i + f0.len);
    const xing = Math.max(head.indexOf('Xing'), head.indexOf('Info'));
    if (xing >= 0) {
      t = -f0.dur;
      const lame = head.indexOf('LAME', xing);
      if (lame >= 0 && lame + 24 <= head.length) {
        const delay = (head[lame + 21] << 4) | (head[lame + 22] >> 4);
        const spf = ((b[i + 1] >> 3) & 3) === 3 ? 1152 : 576;
        t -= ((delay + 529) / spf) * f0.dur; // encoder + decoder delay, in ms
      }
    }
  }
  let startByte = -1, startT = 0;
  // Start on a frame that doesn't borrow bytes from earlier frames, so decoders don't drop it
  // (dropped frames would shift the audio and break sync). Look back up to ~2s for one.
  const recent = [];
  while (i < b.length - 4) {
    const f = frameAt(b, i);
    if (!f) { i++; continue; }
    if (startByte < 0) {
      recent.push([i, t, f.mdb]); if (recent.length > 80) recent.shift();
      if (t + f.dur > fromMs) {
        const clean = [...recent].reverse().find((x) => x[2] === 0);
        [startByte, startT] = clean || recent[Math.max(0, recent.length - 3)];
      }
    } else if (t >= startT + lenMs || i - startByte + f.len > maxBytes) break;
    i += f.len; t += f.dur;
  }
  if (startByte < 0) return null;
  return { data: b.subarray(startByte, i), start: startT };
}

function osuValue(text, key) {
  const m = text.match(new RegExp(`^${key}\\s*:\\s*(.*)$`, 'mi'));
  return m ? m[1].trim() : null;
}

// Song segment for a question: starts a little before the map's preview point.
export async function songSegment(q, lenMs = 60000) {
  let osz = null, why = '';
  for (const u of MIRRORS(q.setId)) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'guess-the-beatmap/1.0' }, redirect: 'follow' });
      if (!r.ok) { why = `${new URL(u).host} ${r.status}`; continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 60_000_000) { why = 'download too large'; continue; }
      osz = unzip(buf); break;
    } catch (e) { why = e.message; }
  }
  if (!osz) throw new Error(`mirror download failed (${why})`);
  // pick the question's difficulty (or any .osu) to read AudioFilename / PreviewTime
  const osuNames = Object.keys(osz).filter((n) => n.endsWith('.osu'));
  let text = null;
  for (const n of osuNames) {
    const t = osz[n]().toString('utf8');
    if (!text || (q.beatmapId && new RegExp(`^BeatmapID\\s*:\\s*${q.beatmapId}\\s*$`, 'm').test(t))) text = t;
    if (q.beatmapId && new RegExp(`^BeatmapID\\s*:\\s*${q.beatmapId}\\s*$`, 'm').test(t)) break;
  }
  if (!text) throw new Error('no .osu in the download');
  const audioName = (osuValue(text, 'AudioFilename') || '').toLowerCase();
  const get = osz[audioName] || osz[Object.keys(osz).find((n) => n.endsWith('/' + audioName))];
  if (!get) throw new Error(`audio file ${audioName} not found`);
  if (!audioName.endsWith('.mp3')) throw new Error(`${audioName.split('.').pop()} audio can't be cut`);
  const song = get();
  const preview = Number(osuValue(text, 'PreviewTime'));
  const from = Math.max(0, (preview > 0 ? preview : 30000) - 1500);
  const seg = cutMp3(song, from, lenMs);
  if (!seg) throw new Error('could not cut the song');
  return seg;
}

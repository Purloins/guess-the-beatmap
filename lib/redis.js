// Minimal Upstash Redis REST client (no dependencies).
// Works with the Vercel Marketplace Upstash integration (KV_REST_API_*) or plain UPSTASH_REDIS_REST_*.
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export const P = 'gtb:'; // key prefix

export async function pipeline(commands) {
  if (!URL_ || !TOKEN) throw new Error('Redis is not configured (set KV_REST_API_URL and KV_REST_API_TOKEN)');
  const r = await fetch(`${URL_}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands.map((c) => c.map(String))),
  });
  if (!r.ok) throw new Error(`Redis error ${r.status}: ${await r.text()}`);
  const out = await r.json();
  for (const x of out) if (x.error) throw new Error(`Redis: ${x.error}`);
  return out.map((x) => x.result);
}

export async function cmd(...c) {
  return (await pipeline([c]))[0];
}

export async function getJSON(key, fallback = null) {
  const v = await cmd('GET', P + key);
  return v == null ? fallback : JSON.parse(v);
}

export async function setJSON(key, value) {
  return cmd('SET', P + key, JSON.stringify(value));
}

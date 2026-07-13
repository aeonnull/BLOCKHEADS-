'use strict';
const crypto = require('crypto');

/* -------------------------------------------------------------------------
 * Persistent leaderboard backed by Upstash Redis (Vercel Marketplace).
 *
 *   bh:lb:scores   sorted set   member = address, score = best score
 *   bh:lb:names    hash         address -> latest display name
 *
 * If Redis isn't configured yet (store not connected in the Vercel
 * dashboard), we transparently fall back to an in-memory list so nothing
 * breaks — that copy is ephemeral, exactly like the old behaviour. The
 * connection env vars are read under either the KV_* or UPSTASH_* names, so
 * this works with whichever Redis integration is connected.
 * ---------------------------------------------------------------------- */
let kv = null;
try {
  const url   = process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    const { Redis } = require('@upstash/redis');
    kv = new Redis({ url, token });
  }
} catch { kv = null; }

const Z_KEY = 'bh:lb:scores';
const H_KEY = 'bh:lb:names';

const RATE = new Map();   // address -> last submit timestamp (ms) — best-effort, per-instance
const RATE_WINDOW = 60_000;
const MAX_SCORE   = 200_000;

function verifyJWT(token, secret) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  const expected = crypto.createHmac('sha256', secret)
    .update(`${header}.${payload}`).digest('base64url');
  if (sig !== expected) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!data.verified || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch { return null; }
}

/* ---- in-memory fallback ------------------------------------------------ */
const MEM = [];
function memUpsert(address, name, score) {
  const ix = MEM.findIndex(e => e.address === address);
  if (ix >= 0) {
    if (score > MEM[ix].score) { MEM[ix].score = score; MEM[ix].name = name; }
  } else {
    MEM.push({ address, name, score });
  }
  MEM.sort((a, b) => b.score - a.score);
  if (MEM.length > 100) MEM.splice(100);
}
function memTop() {
  return MEM.slice(0, 10).map(e => ({ n: e.name, s: e.score }));
}

/* ---- KV backend -------------------------------------------------------- */
async function kvUpsert(address, name, score) {
  // gt: only ever raise a player's score, never lower it
  await kv.zadd(Z_KEY, { gt: true }, { score, member: address });
  await kv.hset(H_KEY, { [address]: name });
}
async function kvTop() {
  const flat = await kv.zrange(Z_KEY, 0, 9, { rev: true, withScores: true });
  if (!flat || !flat.length) return [];
  const rows = [];
  const addrs = [];
  for (let i = 0; i < flat.length; i += 2) {
    addrs.push(flat[i]);
    rows.push({ address: flat[i], s: Number(flat[i + 1]) });
  }
  const names = (await kv.hmget(H_KEY, ...addrs)) || {};
  return rows.map(e => ({ n: names[e.address] || 'ANON', s: e.s }));
}

/* ---- unified helpers (KV with graceful fallback) ----------------------- */
async function readTop() {
  if (!kv) return memTop();
  try { return await kvTop(); }
  catch { return memTop(); }
}
async function writeAndRead(address, name, score) {
  if (kv) {
    try { await kvUpsert(address, name, score); return await kvTop(); }
    catch { /* fall through to memory */ }
  }
  memUpsert(address, name, score);
  return memTop();
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    return res.status(200).json({ leaderboard: await readTop() });
  }

  if (req.method !== 'POST') return res.status(405).end();

  const secret = process.env.JWT_SECRET;
  if (!secret) return res.status(500).end();

  const auth = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  const session = verifyJWT(auth, secret);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });

  const now = Date.now();
  const last = RATE.get(session.address) || 0;
  if (now - last < RATE_WINDOW) return res.status(429).json({ error: 'Too fast' });
  RATE.set(session.address, now);

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return res.status(400).end(); } }
  const { name, score } = body || {};

  if (typeof score !== 'number' || !Number.isInteger(score) || score < 1 || score > MAX_SCORE) {
    return res.status(400).json({ error: 'Invalid score' });
  }
  const nm = String(name || 'ANON').slice(0, 12).replace(/[<>&"']/g, '');

  const leaderboard = await writeAndRead(session.address, nm, score);
  res.status(200).json({ ok: true, leaderboard });
};

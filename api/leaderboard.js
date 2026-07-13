'use strict';
const crypto = require('crypto');

/* -------------------------------------------------------------------------
 * Persistent leaderboard stored in a *secret GitHub Gist* (free, no paid
 * service). A gist is used instead of a repo file so score submissions do
 * not create commits — which would otherwise trigger a Vercel redeploy on
 * every play.
 *
 * Required env vars (set in Vercel):
 *   GH_TOKEN (or GITHUB_TOKEN)  — token with gist read/write permission
 *   GIST_ID                     — id of a secret gist to store scores in
 *
 * If they aren't set, we fall back to an ephemeral in-memory list so the
 * endpoint still works (resets on cold start, like the original).
 *
 * Stored shape (JSON array, best score per address):
 *   [{ address, name, score }, ...]  — top 100
 * ---------------------------------------------------------------------- */
const GH_TOKEN  = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
const GIST_ID   = process.env.GIST_ID || '';
const GH_ON     = !!(GH_TOKEN && GIST_ID);
const GIST_FILE = 'blockheads-leaderboard.json';

const RATE = new Map();   // address -> last submit ms (best-effort, per-instance)
const RATE_WINDOW = 60_000;
const MAX_SCORE   = 200_000;

// Short read cache so repeated page loads don't hammer the GitHub API.
let cache = { at: 0, list: [] };
const CACHE_TTL = 15_000;

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

/* ---- shared list helpers ---------------------------------------------- */
const MEM = [];
function upsert(list, address, name, score) {
  const ix = list.findIndex(e => e.address === address);
  if (ix >= 0) {
    if (score > list[ix].score) { list[ix].score = score; list[ix].name = name; }
  } else {
    list.push({ address, name, score });
  }
  list.sort((a, b) => b.score - a.score);
  if (list.length > 100) list.splice(100);
  return list;
}
function top10(list) {
  return list.slice(0, 10).map(e => ({ n: e.name, s: e.score }));
}

/* ---- GitHub Gist backend ---------------------------------------------- */
function ghHeaders() {
  return {
    'Authorization': `Bearer ${GH_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'blockheads-leaderboard',
  };
}
async function ghRead() {
  const r = await fetch(`https://api.github.com/gists/${GIST_ID}`, { headers: ghHeaders() });
  if (!r.ok) throw new Error(`gist read ${r.status}`);
  const j = await r.json();
  const f = j.files && j.files[GIST_FILE];
  if (!f || !f.content) return [];
  try { const arr = JSON.parse(f.content); return Array.isArray(arr) ? arr : []; }
  catch { return []; }
}
async function ghWrite(list) {
  const r = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
    method: 'PATCH',
    headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ files: { [GIST_FILE]: { content: JSON.stringify(list) } } }),
  });
  if (!r.ok) throw new Error(`gist write ${r.status}`);
}

/* ---- unified read / write (gist with graceful fallback) --------------- */
async function readTop() {
  if (!GH_ON) return top10(MEM);
  const now = Date.now();
  if (now - cache.at < CACHE_TTL) return top10(cache.list);
  const list = await ghRead();
  cache = { at: now, list };
  return top10(list);
}
async function writeAndReadTop(address, name, score) {
  if (!GH_ON) { upsert(MEM, address, name, score); return top10(MEM); }
  const list = await ghRead();
  upsert(list, address, name, score);
  await ghWrite(list);
  cache = { at: Date.now(), list };
  return top10(list);
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    try {
      return res.status(200).json({ leaderboard: await readTop() });
    } catch {
      // serve last known good data if GitHub is unreachable
      return res.status(200).json({ leaderboard: top10(cache.list.length ? cache.list : MEM) });
    }
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

  try {
    const leaderboard = await writeAndReadTop(session.address, nm, score);
    return res.status(200).json({ ok: true, leaderboard });
  } catch {
    // GitHub write failed — keep the play from being lost this instance
    upsert(MEM, session.address, nm, score);
    return res.status(200).json({ ok: true, leaderboard: top10(MEM) });
  }
};

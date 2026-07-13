'use strict';
const crypto = require('crypto');

const LB   = [];          // [{ address, name, score }]  – top 100, sorted desc
const RATE = new Map();   // address -> last submit timestamp (ms)
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

function upsert(address, name, score) {
  const ix = LB.findIndex(e => e.address === address);
  if (ix >= 0) {
    if (score > LB[ix].score) { LB[ix].score = score; LB[ix].name = name; }
  } else {
    LB.push({ address, name, score });
  }
  LB.sort((a, b) => b.score - a.score);
  if (LB.length > 100) LB.splice(100);
}

function topTen() {
  return LB.slice(0, 10).map(e => ({ n: e.name, s: e.score }));
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    return res.status(200).json({ leaderboard: topTen() });
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

  upsert(session.address, nm, score);
  res.status(200).json({ ok: true, leaderboard: topTen() });
};

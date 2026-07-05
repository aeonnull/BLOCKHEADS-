'use strict';
const crypto = require('crypto');

const NONCE_MAX_AGE = 10 * 60 * 1000; // 10 min
const SESSION_TTL   = 24 * 60 * 60;   // 24 h in seconds
const PARENT_ID = process.env.BLOCKHEADS_PARENT_ID
  || '3333c06aab0354040a6a2864e75dbc631524a9d63a4b41fa9930d8a7dcc9f5c4i0';
const HIRO_BASE = 'https://api.hiro.so/ordinals/v1';

// In-memory sets; reset on cold start — acceptable for low traffic MVP
const USED_NONCES = new Set();
const RATE = new Map();

function rateCheck(ip) {
  const now = Date.now();
  const bucket = (RATE.get(ip) || []).filter(t => now - t < 60_000);
  if (bucket.length >= 5) return false;
  bucket.push(now);
  RATE.set(ip, bucket);
  return true;
}

function parseNonceToken(token) {
  // format: "timestamp:randomId.hmac"
  const lastDot = token.lastIndexOf('.');
  if (lastDot < 0) return null;
  const payload = token.slice(0, lastDot);
  const mac     = token.slice(lastDot + 1);
  const colonIdx = payload.indexOf(':');
  if (colonIdx < 0) return null;
  const id = payload.slice(colonIdx + 1);
  return { payload, mac, id };
}

function verifyNonce(token, secret) {
  const parts = parseNonceToken(token);
  if (!parts) return null;

  const expected = crypto.createHmac('sha256', secret).update(parts.payload).digest('hex');
  let valid = false;
  try { valid = crypto.timingSafeEqual(Buffer.from(parts.mac, 'hex'), Buffer.from(expected, 'hex')); }
  catch { return null; }
  if (!valid) return null;

  const ts = parseInt(parts.payload.split(':')[0], 10);
  if (isNaN(ts) || Date.now() - ts > NONCE_MAX_AGE) return null;
  if (USED_NONCES.has(token)) return null;

  return parts; // { payload, mac, id }
}

function issueJWT(address, secret) {
  const now = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    address, verified: true, iat: now, exp: now + SESSION_TTL
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

async function holdsBlockhead(address) {
  const headers = {};
  const apiKey = process.env.HIRO_API_KEY;
  if (apiKey) headers['x-api-key'] = apiKey;

  // Try with parent= query param (Hiro supports it)
  const url = `${HIRO_BASE}/inscriptions?address=${encodeURIComponent(address)}&parent=${encodeURIComponent(PARENT_ID)}&limit=1`;
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`Hiro API ${r.status}`);
  const d = await r.json();

  if (typeof d.total === 'number') return d.total > 0;

  // Fallback: paginate and filter locally
  return paginateCheck(address, headers);
}

async function paginateCheck(address, headers) {
  const limit = 60;
  let offset  = 0;
  for (let page = 0; page < 20; page++) { // max 1 200 inscriptions
    const url = `${HIRO_BASE}/inscriptions?address=${encodeURIComponent(address)}&limit=${limit}&offset=${offset}`;
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`Hiro API ${r.status}`);
    const d = await r.json();
    for (const item of (d.results || [])) {
      if (item.parent === PARENT_ID) return true;
    }
    if ((d.results || []).length < limit) break;
    offset += limit;
  }
  return false;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const nonceSecret = process.env.NONCE_SECRET;
  const jwtSecret   = process.env.JWT_SECRET;
  if (!nonceSecret || !jwtSecret) return res.status(500).json({ error: 'Server misconfiguration' });

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'anon';
  if (!rateCheck(ip)) return res.status(429).json({ error: 'Too many requests' });

  // Parse body (Vercel parses JSON automatically, but guard just in case)
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  }
  const { address, message, signature, nonce } = body || {};
  if (!address || !message || !signature || !nonce) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  // Only Ordinals (taproot) addresses
  if (!address.startsWith('bc1p')) {
    return res.status(400).json({
      error: 'Please use your Ordinals address (starts with bc1p)'
    });
  }

  // 1. Verify nonce token
  const nonceData = verifyNonce(nonce, nonceSecret);
  if (!nonceData) return res.status(400).json({ error: 'Invalid or expired nonce' });

  // 2. Signed message must contain the nonce ID
  if (!message.includes(nonceData.id)) {
    return res.status(400).json({ error: 'Message does not match nonce' });
  }

  // 3. BIP-322 signature verification — server-side only
  try {
    const { Verifier } = require('bip322-js');
    const valid = Verifier.verifySignature(address, message, signature);
    if (!valid) return res.status(401).json({ error: 'Signature verification failed' });
  } catch (err) {
    console.error('BIP-322:', err.message);
    return res.status(401).json({ error: 'Signature verification failed' });
  }

  // Mark nonce as consumed
  USED_NONCES.add(nonce);
  if (USED_NONCES.size > 10_000) USED_NONCES.clear();

  // 4. Check inscription ownership via Hiro Ordinals API
  let holder = false;
  try {
    holder = await holdsBlockhead(address);
  } catch (err) {
    console.error('Hiro API:', err.message);
    return res.status(503).json({ error: 'Kunde inte verifiera just nu — försök igen' });
  }

  if (!holder) {
    return res.status(403).json({ error: 'Ingen BLOCKHEADS hittades på den adressen' });
  }

  // 5. Issue signed HttpOnly session cookie
  const token = issueJWT(address, jwtSecret);
  res.setHeader('Set-Cookie',
    `bh_session=${token}; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL}; Path=/`
  );
  res.status(200).json({ verified: true, address });
};

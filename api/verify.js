'use strict';
const crypto = require('crypto');

const NONCE_MAX_AGE = 10 * 60 * 1000; // 10 min
const SESSION_TTL   = 24 * 60 * 60;   // 24 h in seconds
const PARENT_ID = process.env.BLOCKHEADS_PARENT_ID
  || '3333c06aab0354040a6a2864e75dbc631524a9d63a4b41fa9930d8a7dcc9f5c4i0';

const USED_NONCES = new Set();
const RATE = new Map();

// Module-level cache of BLOCKHEADS UTXO outputs (persists across warm requests)
let BLOCKHEADS_OUTPUTS = null;
let CACHE_TS = 0;
const CACHE_TTL = 30 * 60 * 1000; // 30 min

function rateCheck(ip) {
  const now = Date.now();
  const bucket = (RATE.get(ip) || []).filter(t => now - t < 60_000);
  if (bucket.length >= 5) return false;
  bucket.push(now);
  RATE.set(ip, bucket);
  return true;
}

function parseNonceToken(token) {
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

  return parts;
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

async function fetchOrdinalsPage(page) {
  const url = `https://ordinals.com/r/children/${encodeURIComponent(PARENT_ID)}/inscriptions/${page}`;
  const r = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(12000)
  });
  if (!r.ok) return { children: [], more: false }; // gracefully stop at last page
  return r.json();
}

async function buildBlockheadsCache() {
  const outputs = new Set();

  // Fetch first page
  const first = await fetchOrdinalsPage(0);
  for (const c of (first.children || [])) outputs.add(c.output);

  if (first.more) {
    // Fetch remaining pages in parallel batches of 8
    const BATCH = 8;
    let page = 1;
    let hasMore = true;

    while (hasMore && page < 50) {
      const pageNums = Array.from({ length: BATCH }, (_, i) => page + i);
      const results = await Promise.all(pageNums.map(p => fetchOrdinalsPage(p)));
      for (const d of results) {
        for (const c of (d.children || [])) outputs.add(c.output);
        if (!d.more) { hasMore = false; break; }
      }
      page += BATCH;
    }
  }

  BLOCKHEADS_OUTPUTS = outputs;
  CACHE_TS = Date.now();
  return outputs;
}

async function holdsBlockhead(address) {
  // 1. Get current UTXOs for this address from mempool.space
  const mempoolResp = await fetch(
    `https://mempool.space/api/address/${encodeURIComponent(address)}/utxo`,
    { signal: AbortSignal.timeout(8000) }
  );
  if (!mempoolResp.ok) throw new Error(`mempool.space: ${mempoolResp.status}`);
  const utxos = await mempoolResp.json();
  if (!Array.isArray(utxos) || utxos.length === 0) return false;

  // 2. Ensure BLOCKHEADS output cache is fresh
  if (!BLOCKHEADS_OUTPUTS || Date.now() - CACHE_TS > CACHE_TTL) {
    await buildBlockheadsCache();
  }

  // 3. Check if any user UTXO matches a BLOCKHEADS output
  for (const utxo of utxos) {
    if (BLOCKHEADS_OUTPUTS.has(`${utxo.txid}:${utxo.vout}`)) return true;
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

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  }
  const { address, message, signature, nonce } = body || {};
  if (!address || !message || !signature || !nonce) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  if (!address.startsWith('bc1p')) {
    return res.status(400).json({
      error: 'Please use your Ordinals address (starts with bc1p)'
    });
  }

  // 1. Verify nonce
  const nonceData = verifyNonce(nonce, nonceSecret);
  if (!nonceData) return res.status(400).json({ error: 'Invalid or expired nonce' });

  // 2. Message must contain nonce ID
  if (!message.includes(nonceData.id)) {
    return res.status(400).json({ error: 'Message does not match nonce' });
  }

  // 3. BIP-322 signature verification
  try {
    const { Verifier } = require('bip322-js');
    const valid = Verifier.verifySignature(address, message, signature);
    if (!valid) return res.status(401).json({ error: 'Signature verification failed' });
  } catch (err) {
    console.error('BIP-322:', err.message);
    return res.status(401).json({ error: 'Signature verification failed' });
  }

  USED_NONCES.add(nonce);
  if (USED_NONCES.size > 10_000) USED_NONCES.clear();

  // 4. Check BLOCKHEADS ownership via ordinals.com + mempool.space
  let holder = false;
  try {
    holder = await holdsBlockhead(address);
  } catch (err) {
    console.error('Ownership check:', err.message);
    return res.status(503).json({ error: 'Could not verify right now — please try again' });
  }

  if (!holder) {
    return res.status(403).json({ error: 'No BLOCKHEADS found at that address' });
  }

  // 5. Issue session cookie
  const token = issueJWT(address, jwtSecret);
  res.setHeader('Set-Cookie',
    `bh_session=${token}; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL}; Path=/`
  );
  res.status(200).json({ verified: true, address });
};

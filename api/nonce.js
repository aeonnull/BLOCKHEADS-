'use strict';
const crypto = require('crypto');

const RATE = new Map();

function cleanupRate(map) {
  const cutoff = Date.now() - 120_000;
  for (const [k, v] of map) {
    const fresh = v.filter(t => t > cutoff);
    if (fresh.length === 0) map.delete(k);
    else map.set(k, fresh);
  }
}

module.exports = function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const secret = process.env.NONCE_SECRET;
  if (!secret) return res.status(500).json({ error: 'Server misconfiguration' });

  // Rate limit: 10 nonces per minute per IP
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'anon';
  const now = Date.now();
  if (RATE.size > 5000) cleanupRate(RATE);
  const bucket = (RATE.get(ip) || []).filter(t => now - t < 60_000);
  if (bucket.length >= 10) return res.status(429).json({ error: 'Too many requests' });
  bucket.push(now);
  RATE.set(ip, bucket);

  // Stateless signed nonce: timestamp:randomId.hmac
  const id = crypto.randomBytes(16).toString('hex');
  const payload = `${now}:${id}`;
  const mac = crypto.createHmac('sha256', secret).update(payload).digest('hex');

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ nonce: `${payload}.${mac}` });
};

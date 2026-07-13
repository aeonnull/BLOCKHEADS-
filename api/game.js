'use strict';
const crypto = require('crypto');

const FREE_PLAYS = 2;

function parseCookies(h) {
  const out = {};
  for (const p of (h || '').split(';')) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    const k = p.slice(0, eq).trim();
    const v = p.slice(eq + 1).trim();
    if (k) try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
  }
  return out;
}

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

module.exports = function handler(req, res) {
  const secret = process.env.JWT_SECRET;
  if (!secret) return res.status(500).end();

  const cookies = parseCookies(req.headers.cookie);
  const session = verifyJWT(cookies['bh_session'], secret);

  if (session) {
    res.writeHead(302, { Location: `/blockrunner.html?t=${encodeURIComponent(cookies['bh_session'])}` });
    return res.end();
  }

  const used = Math.min(parseInt(cookies['bh_guest'] || '0', 10) || 0, FREE_PLAYS);
  if (used >= FREE_PLAYS) {
    res.writeHead(302, { Location: '/?connect=1' });
    return res.end();
  }

  const remaining = FREE_PLAYS - used - 1;
  res.setHeader('Set-Cookie',
    `bh_guest=${used + 1}; HttpOnly; SameSite=Strict; Max-Age=${7 * 24 * 3600}; Path=/`
  );
  res.writeHead(302, { Location: `/blockrunner.html?guest=${remaining}` });
  res.end();
};

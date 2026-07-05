'use strict';
const crypto = require('crypto');

function parseCookies(header) {
  const out = {};
  for (const part of (header || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
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
    if (!data.verified) return null;
    if (data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch { return null; }
}

function holdersHTML(address) {
  const short = address.slice(0, 6) + '…' + address.slice(-4);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Holders — BLOCKHEADS</title>
<meta name="robots" content="noindex,nofollow">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@900&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
:root{--black:#0A0A0A;--warm-white:#ECE4D3;--orange:#CC4019;--orange-lt:#E8632B;--grey:#8C857A;--hair:#16140F;--panel:#0E0D0B}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--black);color:var(--warm-white);font-family:"JetBrains Mono",ui-monospace,monospace;font-size:15px;line-height:1.6;-webkit-font-smoothing:antialiased}
a{color:var(--orange-lt);text-decoration:none}
a:hover{color:var(--warm-white)}
:focus-visible{outline:2px solid var(--orange-lt);outline-offset:3px}
.topbar{display:flex;align-items:baseline;justify-content:space-between;gap:16px;padding:20px 22px;max-width:960px;margin:0 auto;border-bottom:1px solid var(--hair)}
.topbar__name{font-family:"Archivo",sans-serif;font-weight:900;font-size:19px;color:var(--warm-white)}
.topbar__right{display:flex;align-items:baseline;gap:16px}
.topbar__addr{font-size:11px;letter-spacing:.1em;color:var(--orange-lt)}
.topbar__meta{font-size:11px;letter-spacing:.22em;color:var(--grey);text-transform:uppercase}
.hero-band{padding:52px 22px 16px;max-width:960px;margin:0 auto}
.eyebrow{font-size:12px;letter-spacing:.28em;text-transform:uppercase;color:var(--orange);font-weight:700;margin-bottom:14px}
.hero-band h2{font-family:"Archivo",sans-serif;font-weight:900;font-size:clamp(28px,6vw,52px);color:var(--warm-white);margin-bottom:10px}
.hero-band p{color:var(--grey);font-size:14px;max-width:480px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;padding:36px 22px 52px;max-width:960px;margin:0 auto}
.card{background:var(--panel);border:1px solid var(--hair);border-radius:4px;padding:28px 24px;display:flex;flex-direction:column;gap:12px}
.card__tag{display:inline-block;font-size:10px;letter-spacing:.22em;text-transform:uppercase;font-weight:700;border:1px solid;padding:2px 8px;border-radius:2px;width:fit-content}
.card__tag--live{color:var(--orange-lt);border-color:var(--orange)}
.card__tag--soon{color:var(--grey);border-color:var(--hair)}
.card__title{font-family:"Archivo",sans-serif;font-weight:900;font-size:22px;color:var(--warm-white)}
.card__desc{font-size:13px;color:var(--grey);line-height:1.7;flex:1}
.card__link{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:700;letter-spacing:.06em;margin-top:4px;transition:color .15s}
.card__link--open{color:var(--orange-lt)}
.card__link--open:hover{color:var(--warm-white)}
.card__link--soon{color:var(--grey);cursor:default}
.arrow{display:inline-block;transition:transform .2s}
.card__link--open:hover .arrow{transform:translate(2px,-2px)}
.logout-row{padding:0 22px 48px;max-width:960px;margin:0 auto;text-align:right}
.logout-btn{background:none;border:1px solid var(--hair);color:var(--grey);font-family:"JetBrains Mono",monospace;font-size:11px;letter-spacing:.12em;padding:6px 16px;cursor:pointer;border-radius:2px;text-transform:uppercase;transition:border-color .15s,color .15s}
.logout-btn:hover{border-color:var(--grey);color:var(--warm-white)}
</style>
</head>
<body>

<div class="topbar">
  <a class="topbar__name" href="/">BLOCKHEADS</a>
  <div class="topbar__right">
    <span class="topbar__addr">${short}</span>
    <span class="topbar__meta">Holders</span>
  </div>
</div>

<div class="hero-band">
  <div class="eyebrow">// Holders only</div>
  <h2>Welcome back</h2>
  <p>Tools and drops reserved for BLOCKHEADS holders.</p>
</div>

<div class="grid">

  <div class="card">
    <span class="card__tag card__tag--live">Live</span>
    <div class="card__title">nscribed</div>
    <p class="card__desc">One link for everything you’ve inscribed — a profile home for what you make and collect on Bitcoin.</p>
    <a class="card__link card__link--open" href="https://nscribed.xyz" target="_blank" rel="noopener">
      Go to nscribed <span class="arrow">&#8599;</span>
    </a>
  </div>

  <div class="card">
    <span class="card__tag card__tag--soon">Soon</span>
    <div class="card__title">Blockheads Runner</div>
    <p class="card__desc">On-chain arcade runner. Climb the leaderboard, stack blocks. Dropping soon — holders get early access.</p>
    <span class="card__link card__link--soon">Coming soon <span class="arrow">→</span></span>
  </div>

</div>

<div class="logout-row">
  <button class="logout-btn" id="logout-btn">Disconnect</button>
</div>

<script>
document.getElementById('logout-btn').addEventListener('click', async function() {
  this.disabled = true;
  await fetch('/api/logout', { method: 'POST' });
  location.href = '/';
});
</script>
</body>
</html>`;
}

module.exports = function handler(req, res) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    res.writeHead(302, { Location: '/?connect=1' });
    res.end();
    return;
  }

  const cookies = parseCookies(req.headers.cookie);
  const session = verifyJWT(cookies['bh_session'], secret);

  if (!session) {
    res.writeHead(302, { Location: '/?connect=1' });
    res.end();
    return;
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, private');
  res.status(200).end(holdersHTML(session.address));
};

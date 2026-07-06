'use strict';
const PARENT_ID = process.env.BLOCKHEADS_PARENT_ID
  || '3333c06aab0354040a6a2864e75dbc631524a9d63a4b41fa9930d8a7dcc9f5c4i0';
const TEST_ADDR = 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr';

module.exports = async function handler(req, res) {
  const results = {};

  const testUrl = async (label, url, headers = {}) => {
    try {
      const r = await fetch(url, {
        headers: { 'Accept': 'application/json', ...headers },
        signal: AbortSignal.timeout(10000)
      });
      const text = await r.text();
      let body;
      try { body = JSON.parse(text); } catch { body = text.slice(0, 200); }
      results[label] = { status: r.status, ok: r.ok, body };
    } catch (e) {
      results[label] = { error: e.message };
    }
  };

  // Test ordinals.com children — count total and show first id
  try {
    const r = await fetch(
      `https://ordinals.com/r/children/${encodeURIComponent(PARENT_ID)}/inscriptions`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) }
    );
    if (r.ok) {
      const d = await r.json();
      const kids = d.children || [];
      results.ordinals_children = {
        status: 200, ok: true,
        total: kids.length,
        firstId: kids[0]?.id,
        firstOutput: kids[0]?.output,
        more: d.more
      };
    } else {
      results.ordinals_children = { status: r.status, ok: false };
    }
  } catch (e) {
    results.ordinals_children = { error: e.message };
  }

  // Test mempool.space UTXO endpoint
  await testUrl('mempool_utxo', `https://mempool.space/api/address/${TEST_ADDR}/utxo`);

  res.status(200).json({ parentId: PARENT_ID, results });
};

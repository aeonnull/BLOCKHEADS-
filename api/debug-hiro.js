'use strict';
const PARENT_ID = process.env.BLOCKHEADS_PARENT_ID
  || '3333c06aab0354040a6a2864e75dbc631524a9d63a4b41fa9930d8a7dcc9f5c4i0';
const HIRO_BASE = 'https://api.hiro.so/ordinals/v1';

module.exports = async function handler(req, res) {
  const key = process.env.HIRO_API_KEY;
  const headers = { 'Accept': 'application/json' };
  if (key) headers['x-api-key'] = key;

  const results = {};

  const testUrl = async (label, url) => {
    try {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
      const text = await r.text();
      let body;
      try { body = JSON.parse(text); } catch { body = text.slice(0, 200); }
      results[label] = { status: r.status, ok: r.ok, body };
    } catch (e) {
      results[label] = { error: e.message };
    }
  };

  await testUrl('hiro_v1_basic', `${HIRO_BASE}/inscriptions?limit=1`);
  await testUrl('hiro_v2_basic', 'https://api.hiro.so/ordinals/v2/inscriptions?limit=1');
  await testUrl('hiro_v1_children', `${HIRO_BASE}/inscriptions/${encodeURIComponent(PARENT_ID)}/children?limit=1`);
  // Magic Eden ordinals API
  await testUrl('magiceden_collection', `https://api-mainnet.magiceden.dev/v2/ord/btc/tokens?limit=1&collectionSymbol=blockheads`);
  // Unisat — check address inscriptions
  const testAddr = 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr'; // sample taproot addr
  await testUrl('unisat_address', `https://open-api.unisat.io/v1/indexer/address/${testAddr}/inscription-utxo-data?cursor=0&size=1`);

  res.status(200).json({
    keyPresent: !!key,
    keyPrefix: key ? key.slice(0, 8) + '...' : null,
    results
  });
};

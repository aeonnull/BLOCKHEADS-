'use strict';
const PARENT_ID = process.env.BLOCKHEADS_PARENT_ID
  || '3333c06aab0354040a6a2864e75dbc631524a9d63a4b41fa9930d8a7dcc9f5c4i0';

module.exports = async function handler(req, res) {
  const results = {};

  const testUrl = async (label, url, extraHeaders = {}) => {
    try {
      const r = await fetch(url, {
        headers: { 'Accept': 'application/json', ...extraHeaders },
        signal: AbortSignal.timeout(8000)
      });
      const text = await r.text();
      let body;
      try { body = JSON.parse(text); } catch { body = text.slice(0, 300); }
      results[label] = { status: r.status, ok: r.ok, body };
    } catch (e) {
      results[label] = { error: e.message };
    }
  };

  // Best In Slot — reliable Ordinals indexer
  await testUrl('bis_inscriptions', 'https://api.bestinslot.xyz/v3/inscription/in_address?address=bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr&count=1&cursor=0&order=0');
  await testUrl('bis_collection', `https://api.bestinslot.xyz/v3/collection/holders?slug=blockheads&count=1&cursor=0`);

  // Unisat
  await testUrl('unisat_inscriptions', 'https://open-api.unisat.io/v1/indexer/address/bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr/inscription-data?cursor=0&size=1');

  // Ordiscan
  await testUrl('ordiscan_address', 'https://api.ordiscan.com/v1/address/bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr/inscriptions?limit=1');

  // OKX Ordinals
  await testUrl('okx_inscriptions', 'https://www.okx.com/api/v5/explorer/btc/address-balance-fills?address=bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr&limit=1&token=BTC-Ordinals');

  res.status(200).json({ parentId: PARENT_ID, results });
};

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

  // Xverse backend API
  await testUrl('xverse_v1', `https://api.xverse.app/v1/address/${TEST_ADDR}/ordinals?limit=1&offset=0`);
  await testUrl('xverse_v2', `https://api.xverse.app/v2/address/${TEST_ADDR}/ordinals?limit=1`);
  await testUrl('xverse_inscriptions', `https://api.xverse.app/v1/address/${TEST_ADDR}/inscriptions?limit=1`);

  // GeniiData
  await testUrl('geniidata', `https://api.geniidata.com/api/1/ordinals/inscriptions?address=${TEST_ADDR}&limit=1`);

  // Ordinals.com recursive API (children of parent)
  await testUrl('ordinals_children', `https://ordinals.com/r/children/${encodeURIComponent(PARENT_ID)}/inscriptions`);
  await testUrl('ordinals_children_0', `https://ordinals.com/r/children/${encodeURIComponent(PARENT_ID)}/inscriptions/0`);

  // ord.net
  await testUrl('ordnet_inscription', `https://ord.net/api/inscription/${encodeURIComponent(PARENT_ID)}`);
  await testUrl('ordnet_address', `https://ord.net/api/address/${TEST_ADDR}`);
  await testUrl('ordnet_children', `https://ord.net/api/inscription/${encodeURIComponent(PARENT_ID)}/children?limit=1`);

  res.status(200).json({ parentId: PARENT_ID, testAddr: TEST_ADDR, results });
};

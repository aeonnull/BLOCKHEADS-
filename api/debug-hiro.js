'use strict';
const PARENT_ID = process.env.BLOCKHEADS_PARENT_ID
  || '3333c06aab0354040a6a2864e75dbc631524a9d63a4b41fa9930d8a7dcc9f5c4i0';
const HIRO_BASE = 'https://api.hiro.so/ordinals/v1';

module.exports = async function handler(req, res) {
  const key = process.env.HIRO_API_KEY;
  const headers = { 'Accept': 'application/json' };
  if (key) headers['x-api-key'] = key;

  const results = {};

  // Test 1: basic inscriptions endpoint
  try {
    const url = `${HIRO_BASE}/inscriptions?limit=1`;
    const r = await fetch(url, { headers });
    results.basic = { status: r.status, ok: r.ok };
    if (r.ok) results.basic.body = await r.json();
    else results.basic.text = await r.text();
  } catch (e) {
    results.basic = { error: e.message };
  }

  // Test 2: children endpoint
  try {
    const url = `${HIRO_BASE}/inscriptions/${encodeURIComponent(PARENT_ID)}/children?limit=1`;
    const r = await fetch(url, { headers });
    results.children = { status: r.status, ok: r.ok };
    if (r.ok) results.children.body = await r.json();
    else results.children.text = await r.text();
  } catch (e) {
    results.children = { error: e.message };
  }

  res.status(200).json({
    keyPresent: !!key,
    keyPrefix: key ? key.slice(0, 8) + '...' : null,
    results
  });
};

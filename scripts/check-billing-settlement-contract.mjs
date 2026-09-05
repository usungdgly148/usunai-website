import fs from 'node:fs';
import assert from 'node:assert/strict';

const kv = fs.readFileSync(new URL('../server/kv-local.js', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server/index.mjs', import.meta.url), 'utf8');
const chat = fs.readFileSync(new URL('../frontend/src/pages/Chat.jsx', import.meta.url), 'utf8');

assert.match(kv, /export async function kvRecordAgentUsage/);
assert.match(kv, /const chargedPoints = allowPartial \? Math\.min\(current, requestedPoints\) : requestedPoints/);
assert.match(kv, /shortfallPoints/);
assert.match(kv, /partialCharge: shortfallPoints > 0/);
assert.match(server, /allowPartial: true,[\s\S]{0,300}computeRecord/);
assert.match(server, /const charge = await recordServerCharge[\s\S]{0,900}\{ allowPartial: true, requestId \}/);
assert.match(server, /type: 'usage'[\s\S]{0,400}chargedPoints/);
assert.match(chat, /const est = serverUsage\s*\|\| await fetchEstimate/);

console.log('billing settlement contract: ok');

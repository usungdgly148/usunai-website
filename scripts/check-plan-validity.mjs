import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { resolveMaxPlanValidity } from '../server/plan-validity.mjs';

const today = '2026-08-22';

const freshPackage = resolveMaxPlanValidity(null, { validDays: 365, fallbackStart: today });
assert.deepEqual(freshPackage, { planValidFrom: today, planValidDays: 365, winner: 'incoming' });

// Roughly 100 days remain. A new 365-day package must end 365 days from today,
// not start at the old expiry and create about 465 remaining days.
const longerIncoming = resolveMaxPlanValidity(
  { planValidFrom: '2026-05-14', planValidDays: 200 },
  { validDays: 365, fallbackStart: today },
);
assert.deepEqual(longerIncoming, { planValidFrom: today, planValidDays: 365, winner: 'incoming' });

const longerExisting = resolveMaxPlanValidity(
  { planValidFrom: today, planValidDays: 500 },
  { validDays: 365, fallbackStart: today },
);
assert.deepEqual(longerExisting, { planValidFrom: today, planValidDays: 500, winner: 'existing' });

const shorterManual = resolveMaxPlanValidity(
  { planValidFrom: today, planValidDays: 100 },
  { validDays: 30, fallbackStart: today },
);
assert.deepEqual(shorterManual, { planValidFrom: today, planValidDays: 100, winner: 'existing' });

const longerManual = resolveMaxPlanValidity(
  { planValidFrom: today, planValidDays: 100 },
  { validDays: 180, fallbackStart: today },
);
assert.deepEqual(longerManual, { planValidFrom: today, planValidDays: 180, winner: 'incoming' });

const existingPermanent = resolveMaxPlanValidity(
  { planValidFrom: '2026-01-01', planValidDays: 0 },
  { validDays: 365, fallbackStart: today },
);
assert.deepEqual(existingPermanent, { planValidFrom: '2026-01-01', planValidDays: 0, winner: 'existing' });

const incomingPermanent = resolveMaxPlanValidity(
  { planValidFrom: today, planValidDays: 500 },
  { validDays: 0, fallbackStart: today },
);
assert.deepEqual(incomingPermanent, { planValidFrom: today, planValidDays: 0, winner: 'incoming' });

const root = path.resolve(import.meta.dirname, '..');
const serverSource = fs.readFileSync(path.join(root, 'server', 'index.mjs'), 'utf8');
assert.match(serverSource, /resolveMaxPlanValidity\(existingUser,/);
assert.match(serverSource, /validityWinner === 'incoming'/);
assert.doesNotMatch(serverSource, /startMs\s*=\s*oldExpiryMs/);

console.log('Plan validity check passed: package and manual adjustments keep the later absolute expiry without stacking durations.');

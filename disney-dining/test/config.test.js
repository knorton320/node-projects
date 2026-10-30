import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';

const validTarget = {
  name: 'Test',
  slug: 'test-slug',
  facilityId: '123',
  entityType: 'dining-event',
  dates: ['2026-12-11'],
  partySizes: [2],
  timeWindow: null,
  enabled: true,
};
const validCanary = {
  name: 'Canary',
  facilityId: '456',
  entityType: 'restaurant',
  partySize: 2,
  daysAhead: 30,
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-'));
let n = 0;
function writeConfig(config) {
  const file = path.join(dir, `config-${n++}.json`);
  fs.writeFileSync(file, JSON.stringify(config));
  return file;
}

test('the real config/targets.json loads', () => {
  const { targets, canary } = loadConfig();
  assert.ok(targets.length >= 1);
  assert.ok(canary);
});

test('a valid config loads and only enabled targets are returned', () => {
  const file = writeConfig({
    targets: [validTarget, { ...validTarget, name: 'Off', enabled: false }],
  });
  const { targets, canary } = loadConfig(file);
  assert.equal(targets.length, 1);
  assert.equal(canary, null);
});

test('timeWindow forms are accepted', () => {
  for (const timeWindow of ['morning', 'afternoon', 'evening', { start: '17:00', end: '20:00' }]) {
    const file = writeConfig({ targets: [{ ...validTarget, timeWindow }], canary: validCanary });
    assert.doesNotThrow(() => loadConfig(file));
  }
});

const badCases = {
  'impossible date': { targets: [{ ...validTarget, dates: ['2026-02-30'] }] },
  'party size 0': { targets: [{ ...validTarget, partySizes: [0] }] },
  'unknown entityType': { targets: [{ ...validTarget, entityType: 'spa' }] },
  'bad timeWindow bucket': { targets: [{ ...validTarget, timeWindow: 'midnight' }] },
  'bad timeWindow range': { targets: [{ ...validTarget, timeWindow: { start: '25:00', end: '20:00' } }] },
  'canary daysAhead 90': { targets: [validTarget], canary: { ...validCanary, daysAhead: 90 } },
};

for (const [name, config] of Object.entries(badCases)) {
  test(`throws on ${name}`, () => {
    assert.throws(() => loadConfig(writeConfig(config)), /Invalid config/);
  });
}

test('reports every problem in one error', () => {
  const file = writeConfig({
    targets: [{ ...validTarget, dates: ['2026-02-30'], partySizes: [0] }],
    canary: { ...validCanary, daysAhead: 90 },
  });
  assert.throws(() => loadConfig(file), (err) => /2026-02-30/.test(err.message) && /party size/.test(err.message) && /daysAhead/.test(err.message));
});

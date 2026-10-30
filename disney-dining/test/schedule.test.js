import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { disableFileLog, enableFileLog, log } from '../src/log.js';
import { nextSleepMs } from '../src/schedule.js';

const minutes = (opts) => nextSleepMs(opts) / 60_000;

test('sleep is the interval plus or minus up to 2 minutes', () => {
  assert.equal(minutes({ intervalMin: 8, random: () => 0.5 }), 8);
  assert.equal(minutes({ intervalMin: 8, random: () => 0 }), 6);
  assert.equal(minutes({ intervalMin: 8, random: () => 1 }), 10);
});

test('sleep is never under 1 minute', () => {
  assert.equal(minutes({ intervalMin: 1, random: () => 0 }), 1);
});

test('sleep doubles per error run, capped at 60 minutes, and resets after a success', () => {
  const base = { intervalMin: 8, random: () => 0.5 };
  assert.equal(minutes({ ...base, consecutiveErrorRuns: 1 }), 16);
  assert.equal(minutes({ ...base, consecutiveErrorRuns: 2 }), 32);
  assert.equal(minutes({ ...base, consecutiveErrorRuns: 3 }), 60);
  assert.equal(minutes({ ...base, consecutiveErrorRuns: 10 }), 60);
  assert.equal(minutes({ ...base, consecutiveErrorRuns: 0 }), 8);
});

test('file log appends, and rotates to .1 when over the size limit', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-'));
  const file = path.join(dir, 'logs', 'watch.log');
  try {
    enableFileLog(file, { maxBytes: 50 });
    log.info('first');
    assert.match(fs.readFileSync(file, 'utf8'), /INFO first\n$/);
    for (let i = 0; i < 5; i++) log.info('padding to pass the size limit');
    enableFileLog(file, { maxBytes: 50 });
    log.info('after rotation');
    assert.match(fs.readFileSync(`${file}.1`, 'utf8'), /first/);
    const fresh = fs.readFileSync(file, 'utf8');
    assert.match(fresh, /after rotation/);
    assert.doesNotMatch(fresh, /first/);
  } finally {
    disableFileLog();
  }
});

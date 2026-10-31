import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { formatResultLine, runOnce } from '../src/check.js';
import { trackAuthorization } from '../src/disney-api.js';
import { loadState } from '../src/state.js';

const target = { name: 'Candlelight' };
const base = { target, date: '2026-12-11', partySize: 2, slots: [] };

test('formats each status line', () => {
  assert.equal(formatResultLine({ ...base, status: 'none' }), 'NONE   Candlelight 2026-12-11 party 2');
  assert.equal(formatResultLine({ ...base, status: 'none', filteredOut: 3 }), 'NONE   Candlelight 2026-12-11 party 2  (3 outside time window)');
  assert.equal(formatResultLine({ ...base, status: 'unparsed' }), 'CHECK  Candlelight 2026-12-11 party 2  Disney says open but times unreadable');
  assert.equal(formatResultLine({ ...base, status: 'error', error: 'HTTP 403 (login expired, or blocked)' }), 'ERROR  Candlelight 2026-12-11 party 2  HTTP 403 (login expired, or blocked)');
  const slots = [
    { time: '17:30', restaurantName: 'Rose & Crown', eventLabel: 'Candlelight 5:00 show' },
    { time: '19:00', restaurantName: null, eventLabel: null },
  ];
  assert.equal(
    formatResultLine({ ...base, status: 'available', slots }),
    'OPEN   Candlelight 2026-12-11 party 2  17:30 Rose & Crown (Candlelight 5:00 show), 19:00',
  );
});

// --- runOnce alert delivery (Discord + Pushover) ---

const fixture = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-check-'));
const ENV_KEYS = ['DISCORD_WEBHOOK_URL', 'DISCORD_MENTION_USER_ID', 'PUSHOVER_APP_TOKEN', 'PUSHOVER_USER_KEY'];
const realFetch = globalThis.fetch;
const savedEnv = {};
let posts;
let discordOk;
let statePath;
let n = 0;

// A page whose in-page fetch returns the given raw Disney result, with an Authorization header
// "captured" the way the real site's requests would be.
function fakePage(raw) {
  const handlers = {};
  const page = {
    on: (event, handler) => { handlers[event] = handler; },
    evaluate: async () => raw,
  };
  trackAuthorization(page);
  handlers.request({ url: () => 'https://x/dine-res/api/y', headers: () => ({ authorization: 'Bearer fake' }) });
  return page;
}

const config = {
  targets: [{
    name: 'Candlelight',
    slug: 'check-test-slug',
    facilityId: '17736025',
    entityType: 'dining-event',
    dates: ['2026-12-11'],
    partySizes: [2],
    timeWindow: null,
  }],
  canary: null,
};
const run = (extra = {}) => runOnce({ config, page: fakePage(fixture('plan-example-success.json')), gapMs: 0, sleep: async () => {}, statePath, ...extra });

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.env.DISCORD_WEBHOOK_URL = 'https://discord.test/webhook';
  process.env.PUSHOVER_APP_TOKEN = 'a'.repeat(30);
  process.env.PUSHOVER_USER_KEY = 'u'.repeat(30);
  posts = { discord: [], pushover: [] };
  discordOk = true;
  statePath = path.join(tmp, `state-${n++}.json`);
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://discord.test')) {
      posts.discord.push(JSON.parse(init.body));
      return { ok: discordOk, status: discordOk ? 204 : 500, text: async () => '', json: async () => ({}) };
    }
    posts.pushover.push(new URLSearchParams(init.body));
    return { ok: true, status: 200, json: async () => ({ status: 1, receipt: 'r' }), text: async () => '' };
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

test('a new slot sends one Discord post and one Pushover post', async () => {
  const { results } = await run({ now: new Date('2026-12-01T12:00:00Z') });
  assert.equal(results[0].status, 'available');
  assert.equal(posts.discord.length, 1);
  assert.equal(posts.pushover.length, 1);
  assert.equal(posts.pushover[0].get('priority'), '2');
  assert.match(posts.pushover[0].get('title'), /OPEN: Candlelight/);
});

test('Discord failing while Pushover succeeds still records the slot, so the next run sends neither again', async () => {
  discordOk = false;
  await run({ now: new Date('2026-12-01T12:00:00Z') });
  assert.equal(posts.discord.length, 1);
  assert.equal(posts.pushover.length, 1);
  assert.ok(Object.keys(loadState(statePath).alerted).length > 0);

  await run({ now: new Date('2026-12-01T12:10:00Z') });
  assert.equal(posts.discord.length, 1);
  assert.equal(posts.pushover.length, 1);
});

test('the heartbeat sends a Discord post only', async () => {
  const noneRaw = { status: 404, url: 'x', contentType: 'application/json', text: '{"errorType":"OFFER_NOT_FOUND"}' };
  // 14:00 UTC on 2026-12-01 is 09:00 in New York, so the daily heartbeat is due.
  await run({ page: fakePage(noneRaw), now: new Date('2026-12-01T14:00:00Z') });
  assert.equal(posts.discord.length, 1);
  assert.match(posts.discord[0].content, /Checker alive/);
  assert.equal(posts.pushover.length, 0);
});

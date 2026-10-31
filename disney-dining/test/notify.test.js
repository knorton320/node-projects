import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPushoverAvailability, formatPushoverUnparsed, pushoverEnabled, sendPushover } from '../src/notify.js';

const KEYS = ['PUSHOVER_APP_TOKEN', 'PUSHOVER_USER_KEY', 'PUSHOVER_RETRY_SEC', 'PUSHOVER_EXPIRE_SEC', 'PUSHOVER_SOUND'];
const realFetch = globalThis.fetch;
const savedEnv = {};
let calls;

const message = { title: 'T', message: 'M', url: 'https://example.com/book', urlTitle: 'Open booking page' };
const reply = (status, body) => ({ status, ok: status < 400, json: async () => body, text: async () => JSON.stringify(body) });

beforeEach(() => {
  for (const key of KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.env.PUSHOVER_APP_TOKEN = 'a'.repeat(30);
  process.env.PUSHOVER_USER_KEY = 'u'.repeat(30);
  calls = [];
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const key of KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

function stubFetch(...replies) {
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: new URLSearchParams(init.body) });
    const next = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (next instanceof Error) throw next;
    return next;
  };
}

const ok = () => reply(200, { status: 1, request: 'r', receipt: 'abc' });

test('with no keys it returns false and never calls fetch', async () => {
  delete process.env.PUSHOVER_USER_KEY;
  stubFetch(ok());
  assert.equal(pushoverEnabled(), false);
  assert.equal(await sendPushover(message), false);
  assert.equal(calls.length, 0);
});

test('the emergency request carries priority, retry, expire, tags and url within the limits', async () => {
  stubFetch(ok());
  assert.equal(await sendPushover({ ...message, title: 'x'.repeat(400), message: 'y'.repeat(2000) }), true);
  const { url, body } = calls[0];
  assert.equal(url, 'https://api.pushover.net/1/messages.json');
  assert.equal(body.get('priority'), '2');
  assert.equal(body.get('retry'), '30');
  assert.equal(body.get('expire'), '900');
  assert.equal(body.get('tags'), 'disney-dining');
  assert.equal(body.get('url'), 'https://example.com/book');
  assert.equal(body.get('url_title'), 'Open booking page');
  assert.equal(body.get('title').length, 250);
  assert.equal(body.get('message').length, 1024);
  assert.equal(body.has('sound'), false);
});

test('retry under 30 and expire over 10800 are clamped; sound is passed when set', async () => {
  process.env.PUSHOVER_RETRY_SEC = '5';
  process.env.PUSHOVER_EXPIRE_SEC = '99999';
  process.env.PUSHOVER_SOUND = 'siren';
  stubFetch(ok());
  await sendPushover(message);
  assert.equal(calls[0].body.get('retry'), '30');
  assert.equal(calls[0].body.get('expire'), '10800');
  assert.equal(calls[0].body.get('sound'), 'siren');
});

test('a long slot list is cut to 1024 characters and ends with "…and N more"', () => {
  const slots = Array.from({ length: 200 }, (_, i) => ({
    time: `${String(10 + (i % 12)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`,
    restaurantName: 'Via Napoli Ristorante e Pizzeria',
    eventLabel: 'Candlelight Processional 4:45 PM Show',
  }));
  const { message: text, title, url, urlTitle } = formatPushoverAvailability({
    target: { name: 'Candlelight', entityType: 'dining-event', slug: 'candlelight-dinner-packages' },
    date: '2026-12-11',
    partySize: 4,
    slots,
  });
  assert.ok(text.length <= 1024);
  assert.match(text, /^Party 4 · 2026-12-11\n/);
  assert.match(text, /…and \d+ more$/);
  assert.equal(title, '🍽️ OPEN: Candlelight');
  assert.equal(url, 'https://disneyworld.disney.go.com/dine-res/dining-event/candlelight-dinner-packages/');
  assert.equal(urlTitle, 'Open booking page');
});

test('a short slot list is shown in full, with no Pluto', () => {
  const { message: text } = formatPushoverAvailability({
    target: { name: 'Candlelight', entityType: 'dining-event', slug: 's' },
    date: '2026-12-11',
    partySize: 2,
    slots: [{ time: '11:40', restaurantName: 'Via Napoli', eventLabel: null }],
  });
  assert.equal(text, 'Party 2 · 2026-12-11\n11:40 — Via Napoli');
});

test('the unparsed alert says to check the page', () => {
  const alert = formatPushoverUnparsed({ target: { name: 'Candlelight', entityType: 'dining-event', slug: 's' }, date: '2026-12-11', partySize: 2 });
  assert.equal(alert.title, '⚠️ POSSIBLY OPEN: Candlelight');
  assert.match(alert.message, /times couldn't be read/);
});

test('success returns true', async () => {
  stubFetch(ok());
  assert.equal(await sendPushover(message), true);
  assert.equal(calls.length, 1);
});

test('a 4xx returns false after exactly one call', async () => {
  stubFetch(reply(400, { status: 0, errors: ['application token is invalid'] }));
  assert.equal(await sendPushover(message, { retryDelayMs: 0 }), false);
  assert.equal(calls.length, 1);
});

test('a 5xx is retried once, then succeeds or gives up', async () => {
  stubFetch(reply(503, {}), ok());
  assert.equal(await sendPushover(message, { retryDelayMs: 0 }), true);
  assert.equal(calls.length, 2);

  calls = [];
  stubFetch(reply(503, {}));
  assert.equal(await sendPushover(message, { retryDelayMs: 0 }), false);
  assert.equal(calls.length, 2);
});

test('a thrown fetch is retried once and never throws', async () => {
  stubFetch(new Error('network down'));
  assert.equal(await sendPushover(message, { retryDelayMs: 0 }), false);
  assert.equal(calls.length, 2);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  addDays,
  clearGone,
  defaultState,
  diffSlots,
  heartbeatDue,
  loadState,
  markAlerted,
  markUnparsedAlerted,
  saveState,
  shouldAlertUnparsed,
  slotKey,
  todayInNewYork,
  updateHealth,
} from '../src/state.js';
import { formatAvailabilityAlert, formatUnparsedAlert } from '../src/notify.js';
import { PLUTO_DELIVERY } from '../src/pluto.js';

const target = { name: 'Candlelight', slug: 'candle', entityType: 'dining-event' };
const slot = (time, restaurantName = 'Rose & Crown', eventLabel = null) => ({ time, restaurantName, eventLabel, offerId: `uuid-${Math.random()}:1` });
const available = (slots, partySize = 2) => ({ target, date: '2026-12-11', partySize, status: 'available', slots });
const none = (partySize = 2) => ({ target, date: '2026-12-11', partySize, status: 'none', slots: [] });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-'));

test('slotKey ignores offerId and uses empty strings for nulls', () => {
  assert.equal(slotKey(available([]), slot('17:30', 'Rose & Crown', null)), 'candle|2026-12-11|2|17:30|Rose & Crown|');
  assert.equal(slotKey(available([]), slot('17:30', 'R', '5pm show')), 'candle|2026-12-11|2|17:30|R|5pm show');
});

test('diffSlots finds new slots; alerted slots are not new again', () => {
  const state = defaultState();
  const first = diffSlots(state, [available([slot('17:30'), slot('18:00')])]);
  assert.equal(first.newSlots.length, 2);
  markAlerted(state, first.newSlots.map((n) => n.key));
  const second = diffSlots(state, [available([slot('17:30'), slot('18:00')])]);
  assert.equal(second.newSlots.length, 0, 'a fresh offerId must not make a slot look new');
  const third = diffSlots(state, [available([slot('17:30'), slot('18:00'), slot('18:30')])]);
  assert.deepEqual(third.newSlots.map((n) => n.slot.time), ['18:30']);
});

test('the same time under a different eventLabel is a new slot', () => {
  const state = defaultState();
  markAlerted(state, [slotKey(available([]), slot('17:30', 'R', 'early show'))]);
  const { newSlots } = diffSlots(state, [available([slot('17:30', 'R', 'early show'), slot('17:30', 'R', 'late show')])]);
  assert.deepEqual(newSlots.map((n) => n.slot.eventLabel), ['late show']);
});

test('a duplicate slot within one run is reported once', () => {
  const { newSlots } = diffSlots(defaultState(), [available([slot('17:30'), slot('17:30')])]);
  assert.equal(newSlots.length, 1);
});

test('gone slots are removed so they alert again if they return', () => {
  const state = defaultState();
  const open = [available([slot('17:30')])];
  markAlerted(state, diffSlots(state, open).newSlots.map((n) => n.key));
  const closed = diffSlots(state, [none()]);
  assert.equal(closed.goneKeys.length, 1);
  clearGone(state, closed.goneKeys);
  assert.deepEqual(state.alerted, {});
  assert.equal(diffSlots(state, open).newSlots.length, 1);
});

test('errors, unparsed and unchecked groups never clear alerted slots', () => {
  const state = defaultState();
  markAlerted(state, [slotKey(available([]), slot('17:30'))]);
  for (const result of [
    { ...none(), status: 'error', error: 'HTTP 500' },
    { ...none(), status: 'unparsed' },
    none(4), // a different party size
  ]) {
    assert.deepEqual(diffSlots(state, [result]).goneKeys, []);
  }
});

test('unparsed re-alerts after 30 minutes but not before', () => {
  const state = defaultState();
  const result = { target, date: '2026-12-11', partySize: 2, status: 'unparsed', slots: [] };
  const t0 = new Date('2026-10-30T14:00:00Z');
  assert.equal(shouldAlertUnparsed(state, result, t0), true);
  markUnparsedAlerted(state, result, t0);
  assert.equal(shouldAlertUnparsed(state, result, new Date(t0.getTime() + 29 * 60000)), false);
  assert.equal(shouldAlertUnparsed(state, result, new Date(t0.getTime() + 31 * 60000)), true);
  assert.equal(shouldAlertUnparsed(state, { ...result, partySize: 4 }, t0), true);
});

test('the error counter alerts at 3 runs, only once, then recovers', () => {
  const state = defaultState();
  assert.deepEqual(updateHealth(state, { hadErrors: true }), { alertFailing: false, alertRecovered: false });
  assert.deepEqual(updateHealth(state, { hadErrors: true }), { alertFailing: false, alertRecovered: false });
  assert.deepEqual(updateHealth(state, { hadErrors: true }), { alertFailing: true, alertRecovered: false });
  assert.equal(state.errorAlertSent, true);
  assert.deepEqual(updateHealth(state, { hadErrors: true }), { alertFailing: false, alertRecovered: false });
  assert.deepEqual(updateHealth(state, { hadErrors: false }), { alertFailing: false, alertRecovered: true });
  assert.equal(state.consecutiveErrorRuns, 0);
  assert.equal(state.errorAlertSent, false);
  assert.deepEqual(updateHealth(state, { hadErrors: false }), { alertFailing: false, alertRecovered: false });
});

test('a success before the third error resets the counter without a recovery message', () => {
  const state = defaultState();
  updateHealth(state, { hadErrors: true });
  updateHealth(state, { hadErrors: true });
  assert.deepEqual(updateHealth(state, { hadErrors: false }), { alertFailing: false, alertRecovered: false });
  assert.equal(state.consecutiveErrorRuns, 0);
});

test('saveState and loadState round-trip; a missing or corrupt file gives defaults', () => {
  const file = path.join(dir, 'sub', 'state.json');
  assert.deepEqual(loadState(file), defaultState());
  const state = defaultState();
  markAlerted(state, ['a|b'], new Date('2026-10-30T14:00:00Z'));
  saveState(state, file);
  assert.deepEqual(loadState(file), state);
  assert.equal(fs.existsSync(`${file}.tmp`), false);
  fs.writeFileSync(file, '{not json');
  assert.deepEqual(loadState(file), defaultState());
});

test('heartbeat is due once per New York day, from 09:00', () => {
  const state = defaultState();
  const before9 = new Date('2026-10-30T12:59:00Z'); // 08:59 EDT
  const at9 = new Date('2026-10-30T13:00:00Z'); // 09:00 EDT
  assert.equal(heartbeatDue(state, before9), false);
  assert.equal(heartbeatDue(state, at9), true);
  state.lastHeartbeatDate = todayInNewYork(at9);
  assert.equal(state.lastHeartbeatDate, '2026-10-30');
  assert.equal(heartbeatDue(state, new Date('2026-10-30T20:00:00Z')), false);
  assert.equal(heartbeatDue(state, new Date('2026-10-31T13:00:00Z')), true);
});

test('todayInNewYork uses New York time, and addDays does UTC date math', () => {
  assert.equal(todayInNewYork(new Date('2026-10-31T02:00:00Z')), '2026-10-30');
  assert.equal(addDays('2026-10-30', 30), '2026-11-29');
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
});

test('alert formatters', () => {
  process.env.DISCORD_MENTION_USER_ID = '123456789012345678';
  const alert = formatAvailabilityAlert(available([slot('17:30', 'Rose & Crown', 'Candlelight 5:00 show')]), new Date('2026-10-30T14:00:00Z'));
  assert.ok(alert.content.startsWith('<@123456789012345678> Pluto has a dining reservation for you. Book now!\n```'));
  assert.ok(alert.content.endsWith('```'));
  assert.match(alert.content, /a message for you!/);
  assert.ok(alert.content.length < 2000);
  assert.ok(!PLUTO_DELIVERY.includes('```'), 'three backticks in a row would end the Discord code block');
  assert.match(PLUTO_DELIVERY, /Ñë§§/, "the artist's signature must stay");
  const [embed] = alert.embeds;
  assert.equal(embed.title, '🍽️ OPEN: Candlelight');
  assert.equal(embed.url, 'https://disneyworld.disney.go.com/dine-res/dining-event/candle/');
  assert.deepEqual(embed.fields.map((f) => f.value), ['2026-12-11', '2', '17:30 — Rose & Crown (Candlelight 5:00 show)']);
  assert.match(embed.footer.text, /2026-10-30T14:00:00/);

  const unparsed = formatUnparsedAlert(available([]));
  assert.equal(unparsed.embeds[0].title, '⚠️ POSSIBLY OPEN: Candlelight');
  assert.match(unparsed.embeds[0].description, /couldn't be read/);

  process.env.DISCORD_MENTION_USER_ID = 'kylenorton'; // a username can't be pinged
  assert.ok(formatAvailabilityAlert(available([slot('17:30')])).content.startsWith('Pluto has a dining reservation'));
  delete process.env.DISCORD_MENTION_USER_ID;
  assert.ok(formatAvailabilityAlert(available([slot('17:30')])).content.startsWith('Pluto has a dining reservation'));

  const many = formatAvailabilityAlert(available(Array.from({ length: 200 }, (_, i) => slot(`${String(i % 24).padStart(2, '0')}:00`, `Restaurant number ${i}`))));
  assert.ok(many.embeds[0].fields[2].value.length <= 1024);
  assert.match(many.embeds[0].fields[2].value, /…and \d+ more$/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  applyTimeWindow,
  classifyResult,
  extractSlots,
  filterByTimeWindow,
} from '../src/parse.js';

const fixture = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const DATE = '2026-12-11';
const ctx = { date: DATE, partySize: 2 };
const raw = (status, text, contentType = 'application/json') => ({ status, url: 'inline', contentType, text });

test('extractSlots reads the plan example (restaurants and dining events)', () => {
  const json = JSON.parse(fixture('plan-example-success.json').text);
  const slots = extractSlots(json, DATE);
  const chefs = slots.filter((s) => s.restaurantName === 'Chefs de France');
  assert.equal(chefs.length, 4);
  assert.deepEqual(chefs.map((s) => s.time), ['12:20', '12:30', '18:30', '19:30']);
  assert.equal(chefs[0].restaurantId, '90001373');
  assert.equal(chefs[2].mealPeriod, 'Dinner');
  const fantasmic = slots.filter((s) => s.eventLabel === 'Fantasmic! Viewing 2nd Show');
  assert.equal(fantasmic.length, 2);
  assert.ok(fantasmic.every((s) => s.restaurantName === 'The Hollywood Brown Derby'));
  assert.equal(slots.length, 6);
  assert.equal(extractSlots(json, '2026-12-12').length, 0);
});

test('"none" responses classify as none', () => {
  for (const name of ['plan-example-none.json', 'facility-none-dining-event.json']) {
    const result = classifyResult(fixture(name), ctx);
    assert.equal(result.status, 'none', name);
    assert.deepEqual(result.slots, []);
  }
});

test('the real facility success (date-keyed shape) classifies as available', () => {
  const result = classifyResult(fixture('facility-success-restaurant.json'), {
    ...ctx,
    restaurantName: 'Chefs de France',
    restaurantId: '90001373',
  });
  assert.equal(result.status, 'available');
  assert.ok(result.slots.length >= 1);
  for (const slot of result.slots) {
    assert.equal(slot.date, DATE);
    assert.match(slot.time, /^\d\d:\d\d$/);
    assert.equal(slot.partySize, 2);
    assert.equal(slot.restaurantName, 'Chefs de France');
    assert.equal(slot.restaurantId, '90001373');
  }
});

test('the plan-example success classifies as available with names from the response', () => {
  const result = classifyResult(fixture('plan-example-success.json'), ctx);
  assert.equal(result.status, 'available');
  assert.equal(result.slots.length, 6);
  assert.ok(result.slots.every((s) => s.partySize === 2));
});

test('the general search fixture yields slots', () => {
  const json = JSON.parse(fixture('general-search-success.json').text);
  assert.ok(extractSlots(json, DATE).length >= 1);
});

test('errors: 403, 401, HTML, invalid JSON, other statuses', () => {
  assert.equal(classifyResult(raw(403, '{}'), ctx).status, 'error');
  assert.equal(classifyResult(raw(401, '{}'), ctx).status, 'error');
  const html = classifyResult(raw(200, '<html>Access Denied</html>', 'text/html; charset=utf-8'), ctx);
  assert.equal(html.status, 'error');
  assert.match(html.error, /HTML/);
  assert.equal(classifyResult(raw(200, 'not json at all'), ctx).status, 'error');
  assert.equal(classifyResult(raw(404, 'not json'), ctx).status, 'error');
  assert.equal(classifyResult(raw(404, '{"errorType":"SOMETHING_ELSE"}'), ctx).status, 'error');
  const other = classifyResult(raw(500, '{}'), ctx);
  assert.equal(other.status, 'error');
  assert.equal(other.error, 'HTTP 500');
});

test('a 200 with nothing readable is unparsed', () => {
  const result = classifyResult(raw(200, '{}'), ctx);
  assert.equal(result.status, 'unparsed');
  assert.deepEqual(result.slots, []);
});

const slot = (time) => ({ time, restaurantName: 'R', eventLabel: null });
const slots = ['05:59', '06:00', '11:59', '12:00', '15:59', '16:00', '23:59'].map(slot);
const times = (list) => list.map((s) => s.time);

test('timeWindow null keeps everything', () => {
  assert.equal(filterByTimeWindow(slots, null).length, slots.length);
});

test('timeWindow buckets', () => {
  assert.deepEqual(times(filterByTimeWindow(slots, 'morning')), ['06:00', '11:59']);
  assert.deepEqual(times(filterByTimeWindow(slots, 'afternoon')), ['12:00', '15:59']);
  assert.deepEqual(times(filterByTimeWindow(slots, 'evening')), ['16:00', '23:59']);
});

test('timeWindow {start, end} is inclusive', () => {
  assert.deepEqual(times(filterByTimeWindow(slots, { start: '12:00', end: '16:00' })), ['12:00', '15:59', '16:00']);
});

test('slots with no readable time are kept', () => {
  assert.equal(filterByTimeWindow([slot(null)], 'morning').length, 1);
});

test('applyTimeWindow: partly filtered stays available and counts filteredOut', () => {
  const result = applyTimeWindow({ status: 'available', slots: slots.slice(0, 4) }, 'morning');
  assert.equal(result.status, 'available');
  assert.equal(result.slots.length, 2);
  assert.equal(result.filteredOut, 2);
});

test('applyTimeWindow: all filtered out becomes none', () => {
  const result = applyTimeWindow({ status: 'available', slots: [slot('18:00'), slot('19:00')] }, 'morning');
  assert.equal(result.status, 'none');
  assert.equal(result.filteredOut, 2);
  assert.deepEqual(result.slots, []);
});

test('applyTimeWindow never touches unparsed, none or error', () => {
  for (const status of ['unparsed', 'none', 'error']) {
    const result = applyTimeWindow({ status, slots: [] }, 'morning');
    assert.equal(result.status, status);
    assert.equal(result.filteredOut, 0);
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatResultLine } from '../src/check.js';

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

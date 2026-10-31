import fs from 'node:fs';
import { loadConfig } from '../src/config.js';
import { formatPushoverAvailability, pushoverEnabled, sendPushover } from '../src/notify.js';
import { classifyResult } from '../src/parse.js';

if (!pushoverEnabled()) {
  console.error('PUSHOVER_APP_TOKEN and PUSHOVER_USER_KEY must both be set in .env');
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(new URL('../test/fixtures/plan-example-success.json', import.meta.url), 'utf8'));
const date = '2026-12-11';
const { slots } = classifyResult(raw, { date, partySize: 2 });
const { targets } = loadConfig();

const alert = formatPushoverAvailability({ target: targets[0], date, partySize: 2, slots });
alert.title = `[TEST] ${alert.title}`;

// Emergency priority, but it stops repeating after 2 minutes (about four repeats) if nobody acknowledges it.
const sent = await sendPushover(alert, { expireSec: 120 });
console.log(sent ? 'Test alert sent to Pushover. Acknowledge it in the app to stop the repeats.' : 'Test alert FAILED (see log above).');
process.exit(sent ? 0 : 1);

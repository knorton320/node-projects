import fs from 'node:fs';
import { loadConfig } from '../src/config.js';
import { formatAvailabilityAlert, sendDiscord } from '../src/notify.js';
import { classifyResult } from '../src/parse.js';

const raw = JSON.parse(fs.readFileSync(new URL('../test/fixtures/plan-example-success.json', import.meta.url), 'utf8'));
const date = '2026-12-11';
const { slots } = classifyResult(raw, { date, partySize: 2 });
const { targets } = loadConfig();

const alert = formatAvailabilityAlert({ target: targets[0], date, partySize: 2, slots });
alert.embeds[0].title = `[TEST] ${alert.embeds[0].title}`;

const sent = await sendDiscord(alert);
console.log(sent ? 'Test alert sent to Discord.' : 'Test alert FAILED (see log above).');
process.exit(sent ? 0 : 1);

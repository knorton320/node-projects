import { mkdirSync, writeFileSync } from 'node:fs';
import { openSession } from '../src/browser.js';
import {
  apiRequest,
  getFacilityAvailability,
  getGeneralAvailability,
  isLoggedIn,
} from '../src/disney-api.js';
import { log } from '../src/log.js';

const DATE = '2026-12-11';
const CANDLELIGHT = { facilityId: '17736025', entityType: 'dining-event' };
const CONTROL = { facilityId: '90001373', entityType: 'restaurant' };
const GAP_MS = 5000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const headless = process.env.HEADLESS === 'true';

mkdirSync('local/raw', { recursive: true });

const { page, close } = await openSession({
  headless,
  profileDir: process.env.PROFILE_DIR || 'local/profile',
  storageState: process.env.STORAGE_STATE || undefined,
  url: 'https://disneyworld.disney.go.com/dine-res/dining-event/candlelight-dinner-packages/',
});
log.info('Spike started', { headless, profile: process.env.PROFILE_DIR || 'local/profile' });

let calls = 0;
async function step(n, name, fn) {
  if (calls > 0) await sleep(GAP_MS);
  calls++;
  const raw = await fn();
  writeFileSync(`local/raw/spike-${n}-${name}.json`, JSON.stringify(raw, null, 2));
  const body = typeof raw.text === 'string' ? raw.text : JSON.stringify(raw);
  console.log(`${name}  status=${raw.status ?? 'n/a'}  size=${body.length}  ${body.slice(0, 150).replace(/\s+/g, ' ')}`);
  return raw;
}

try {
  await step(1, 'candlelight-p4', () => getFacilityAvailability(page, { ...CANDLELIGHT, partySize: 4, date: DATE }));
  await step(2, 'candlelight-p2', () => getFacilityAvailability(page, { ...CANDLELIGHT, partySize: 2, date: DATE }));
  const control = await step(3, 'control', () => getFacilityAvailability(page, { ...CONTROL, partySize: 2, date: DATE }));

  if (control.status >= 400 && control.status < 500) {
    await step(4, 'control-bare', () =>
      apiRequest(page, {
        path: `/dine-res/api/availability/2/${DATE}?facilityId=${CONTROL.facilityId}&entityType=${CONTROL.entityType}`,
        functionName: 'getAvailability',
      }));
  }

  const general = await step(5, 'general-p2', () => getGeneralAvailability(page, { partySize: 2, date: DATE }));
  try {
    const json = JSON.parse(general.text);
    console.log(`general-p2: Candlelight (17736025) has times for party 2: ${Boolean(json.diningEvent?.['17736025'])}`);
  } catch {
    console.log('general-p2: body was not JSON');
  }

  await step(6, 'logged-in', async () => ({ status: 200, loggedIn: await isLoggedIn(page) }));
  console.log(`Disney calls this run: ${calls}`);
} finally {
  await close();
}

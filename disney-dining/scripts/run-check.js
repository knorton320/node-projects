import { runCheck, formatResultLine } from '../src/check.js';
import { bookingUrl, loadConfig } from '../src/config.js';
import { openSession } from '../src/browser.js';
import { getFacilityAvailability } from '../src/disney-api.js';
import { log } from '../src/log.js';
import { formatAvailabilityAlert, formatUnparsedAlert, sendDiscord } from '../src/notify.js';
import { classifyResult } from '../src/parse.js';
import {
  addDays,
  clearGone,
  diffSlots,
  heartbeatDue,
  loadState,
  markAlerted,
  markUnparsedAlerted,
  saveState,
  shouldAlertUnparsed,
  todayInNewYork,
  updateHealth,
} from '../src/state.js';

const CANARY_GAP_MS = 5000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const config = loadConfig();
if (config.targets.length === 0) {
  console.error('No enabled targets in config/targets.json');
  process.exit(1);
}

// Checks the control restaurant, which should always have times. If it doesn't, the parser or the
// API has probably changed, and a silent "nothing open" would be misleading.
async function checkCanary(page, canary, now) {
  await sleep(CANARY_GAP_MS);
  const date = addDays(todayInNewYork(now), canary.daysAhead);
  try {
    const raw = await getFacilityAvailability(page, {
      facilityId: canary.facilityId,
      entityType: canary.entityType,
      partySize: canary.partySize,
      date,
    });
    return classifyResult(raw, { date, partySize: canary.partySize, restaurantName: canary.name, restaurantId: canary.facilityId });
  } catch (err) {
    return { status: 'error', slots: [], error: err.message };
  }
}

function summarize(results) {
  const count = (status) => results.filter((r) => r.status === status).length;
  return `${results.length} checks: ${count('available')} open, ${count('none')} none, ${count('unparsed')} unreadable`;
}

async function sendAlerts({ results, page, state, now, hadErrors, firstError }) {
  // New availability: one alert per target/date/party size. Record a slot only once its alert is
  // sent, so a failed Discord post is retried on the next run.
  const { newSlots, goneKeys } = diffSlots(state, results);
  const byResult = new Map();
  for (const { key, result, slot } of newSlots) {
    if (!byResult.has(result)) byResult.set(result, { keys: [], slots: [] });
    byResult.get(result).keys.push(key);
    byResult.get(result).slots.push(slot);
  }
  for (const [result, { keys, slots }] of byResult) {
    if (await sendDiscord(formatAvailabilityAlert({ ...result, slots }, now))) markAlerted(state, keys, now);
  }
  clearGone(state, goneKeys);

  for (const result of results.filter((r) => r.status === 'unparsed')) {
    if (shouldAlertUnparsed(state, result, now) && (await sendDiscord(formatUnparsedAlert(result, now)))) {
      markUnparsedAlerted(state, result, now);
    }
  }

  const health = updateHealth(state, { hadErrors });
  if (health.alertFailing) await sendDiscord({ content: `⚠️ Disney checker failing: ${firstError}` });
  if (health.alertRecovered) await sendDiscord({ content: '✅ Disney checker recovered' });

  if (!hadErrors && page && heartbeatDue(state, now)) {
    let message;
    if (config.canary) {
      const canary = await checkCanary(page, config.canary, now);
      message = canary.status === 'available'
        ? `💓 Checker alive — canary OK (${canary.slots.length} times) — last result: ${summarize(results)}`
        : `⚠️ Canary failed (${canary.status}): ${config.canary.name.replace(/ \(canary\)$/, '')} shows no times — the checker may be broken (API or page changed)`;
    } else {
      message = `💓 Checker alive — last result: ${summarize(results)}`;
    }
    if (await sendDiscord({ content: message })) state.lastHeartbeatDate = todayInNewYork(now);
  }
}

const state = loadState();
const now = new Date();
let session;
let results = [];
let hadErrors = false;
let firstError = null;
try {
  session = await openSession({
    headless: process.env.HEADLESS === 'true',
    profileDir: process.env.PROFILE_DIR || 'local/profile',
    storageState: process.env.STORAGE_STATE || undefined,
    url: bookingUrl(config.targets[0]),
  });
  ({ results, hadErrors } = await runCheck({ config, page: session.page }));
  for (const result of results) console.log(formatResultLine(result));
  firstError = results.find((r) => r.status === 'error')?.error ?? null;
} catch (err) {
  log.error('Check failed', { message: err.message });
  console.log(`ERROR  ${err.message}`);
  hadErrors = true;
  firstError = err.message;
}

try {
  await sendAlerts({ results, page: session?.page, state, now, hadErrors, firstError });
} catch (err) {
  log.error('Alerting failed', { message: err.message });
}
saveState(state);
await session?.close();
process.exit(hadErrors ? 1 : 0);

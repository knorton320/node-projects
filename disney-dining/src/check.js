import { mkdirSync, writeFileSync } from 'node:fs';
import { getFacilityAvailability } from './disney-api.js';
import { log } from './log.js';
import {
  formatAvailabilityAlert,
  formatPushoverAvailability,
  formatPushoverUnparsed,
  formatUnparsedAlert,
  sendDiscord,
  sendPushover,
} from './notify.js';
import { applyTimeWindow, classifyResult } from './parse.js';
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
} from './state.js';

const GAP_MS = 5000;
const MAX_CALLS = 20;

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// One full pass over every enabled target x date x party size. The page must already be loaded
// (openSession/loadPage), so the site's Authorization header has been captured.
export async function runCheck({ config, page, gapMs = GAP_MS, sleep = defaultSleep }) {
  const jobs = config.targets.flatMap((target) =>
    target.dates.flatMap((date) => target.partySizes.map((partySize) => ({ target, date, partySize }))));
  if (jobs.length > MAX_CALLS) {
    throw new Error(`Config needs ${jobs.length} Disney calls per run; the budget is ${MAX_CALLS}`);
  }

  mkdirSync('local/raw', { recursive: true });
  const results = [];
  for (const [i, { target, date, partySize }] of jobs.entries()) {
    if (i > 0) await sleep(gapMs);

    let raw;
    try {
      raw = await getFacilityAvailability(page, { facilityId: target.facilityId, entityType: target.entityType, partySize, date });
      writeFileSync(`local/raw/check-${target.slug}-${date}-p${partySize}.json`, JSON.stringify(raw, null, 2));
    } catch (err) {
      raw = { status: 0, url: '', contentType: '', text: '', failure: err.message };
    }

    const classified = raw.failure
      ? { status: 'error', slots: [], error: raw.failure }
      : classifyResult(raw, {
          date,
          partySize,
          restaurantName: target.entityType === 'restaurant' ? target.name : null,
          restaurantId: target.entityType === 'restaurant' ? target.facilityId : null,
        });
    const { status, slots, error, filteredOut = 0 } = applyTimeWindow(classified, target.timeWindow);
    log.debug('Checked', { target: target.slug, date, partySize, status, slots: slots.length, filteredOut });
    results.push({ target, date, partySize, status, slots, error, filteredOut });
  }

  return { results, hadErrors: results.some((r) => r.status === 'error') };
}

const TAGS = { none: 'NONE', available: 'OPEN', unparsed: 'CHECK', error: 'ERROR' };

export function formatResultLine({ target, date, partySize, status, slots, error, filteredOut = 0 }) {
  const head = `${TAGS[status].padEnd(7)}${target.name} ${date} party ${partySize}`;
  if (status === 'available') {
    const times = slots.map((s) => `${s.time}${s.restaurantName ? ` ${s.restaurantName}` : ''}${s.eventLabel ? ` (${s.eventLabel})` : ''}`);
    return `${head}  ${times.join(', ')}`;
  }
  if (status === 'unparsed') return `${head}  Disney says open but times unreadable`;
  if (status === 'error') return `${head}  ${error}`;
  return filteredOut > 0 ? `${head}  (${filteredOut} outside time window)` : head;
}

// Checks the control restaurant, which should always have times. If it doesn't, the parser or the
// API has probably changed, and a silent "nothing open" would be misleading.
async function checkCanary(page, canary, now) {
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

// Real alerts (something to book) go to Discord and Pushover together. Either one accepting counts
// as delivered, so a Discord outage doesn't set off the emergency alarm again on every run.
async function sendBoth(discordMessage, pushoverMessage) {
  const [discord, pushover] = await Promise.all([sendDiscord(discordMessage), sendPushover(pushoverMessage)]);
  log.info('Alert sent', { discord, pushover });
  return discord || pushover;
}

async function sendAlerts({ config, results, page, state, now, hadErrors, firstError, gapMs, sleep }) {
  // New availability: one alert per target/date/party size. Record a slot only once an alert channel
  // accepted it, so a total failure is retried on the next run.
  const { newSlots, goneKeys } = diffSlots(state, results);
  const byResult = new Map();
  for (const { key, result, slot } of newSlots) {
    if (!byResult.has(result)) byResult.set(result, { keys: [], slots: [] });
    byResult.get(result).keys.push(key);
    byResult.get(result).slots.push(slot);
  }
  for (const [result, { keys, slots }] of byResult) {
    const alertResult = { ...result, slots };
    if (await sendBoth(formatAvailabilityAlert(alertResult, now), formatPushoverAvailability(alertResult))) {
      markAlerted(state, keys, now);
    }
  }
  clearGone(state, goneKeys);

  for (const result of results.filter((r) => r.status === 'unparsed')) {
    if (shouldAlertUnparsed(state, result, now) && (await sendBoth(formatUnparsedAlert(result, now), formatPushoverUnparsed(result)))) {
      markUnparsedAlerted(state, result, now);
    }
  }

  const health = updateHealth(state, { hadErrors });
  if (health.alertFailing) await sendDiscord({ content: `⚠️ Disney checker failing: ${firstError}` });
  if (health.alertRecovered) await sendDiscord({ content: '✅ Disney checker recovered' });

  if (!hadErrors && page && heartbeatDue(state, now)) {
    let message;
    if (config.canary) {
      await sleep(gapMs);
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

// One full run, shared by `npm run check` and the watcher: check every target, then alert, update
// the health counters, and send the daily heartbeat and canary. `openError` is set when the browser
// session couldn't even be opened, which still counts as an error run.
export async function runOnce({ config, page, openError = null, now = new Date(), gapMs = GAP_MS, sleep = defaultSleep, statePath }) {
  const state = loadState(statePath);
  let results = [];
  let hadErrors = false;
  let firstError = null;

  if (openError) {
    hadErrors = true;
    firstError = openError;
  } else {
    try {
      ({ results, hadErrors } = await runCheck({ config, page, gapMs, sleep }));
      firstError = results.find((r) => r.status === 'error')?.error ?? null;
    } catch (err) {
      log.error('Check failed', { message: err.message });
      hadErrors = true;
      firstError = err.message;
    }
  }

  try {
    await sendAlerts({ config, results, page: openError ? null : page, state, now, hadErrors, firstError, gapMs, sleep });
  } catch (err) {
    log.error('Alerting failed', { message: err.message });
  }
  saveState(state, statePath);
  return { results, hadErrors, firstError };
}

import { mkdirSync, writeFileSync } from 'node:fs';
import { getFacilityAvailability } from './disney-api.js';
import { log } from './log.js';
import { applyTimeWindow, classifyResult } from './parse.js';

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

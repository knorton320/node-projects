import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const STATE_PATH = 'local/state.json';
const UNPARSED_REALERT_MS = 30 * 60 * 1000;
const ERROR_RUNS_BEFORE_ALERT = 3;
const HEARTBEAT_HOUR = 9;
const TIME_ZONE = 'America/New_York';

export function defaultState() {
  return {
    alerted: {},
    unparsedAlertedAt: {},
    consecutiveErrorRuns: 0,
    errorAlertSent: false,
    lastHeartbeatDate: null,
  };
}

export function loadState(file = STATE_PATH) {
  try {
    return { ...defaultState(), ...JSON.parse(readFileSync(file, 'utf8')) };
  } catch {
    return defaultState();
  }
}

// Writes a temp file and renames it, so a crash can't leave a half-written state file.
export function saveState(state, file = STATE_PATH) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, file);
}

// Never includes `offerId`: it changes on every search.
export function slotKey(result, slot) {
  return [result.target.slug, result.date, result.partySize, slot.time, slot.restaurantName ?? '', slot.eventLabel ?? ''].join('|');
}

const groupPrefix = (result) => `${result.target.slug}|${result.date}|${result.partySize}|`;

// `newSlots`: slots in `available` results that haven't been alerted yet, as { key, result, slot }.
// `goneKeys`: alerted keys that a conclusive check (available or none) no longer shows.
// Errors and unparsed results say nothing about what's open, so they never clear a key.
export function diffSlots(state, results) {
  const newSlots = [];
  const seen = new Set();
  const conclusivePrefixes = [];
  const present = new Set();

  for (const result of results) {
    if (result.status === 'available' || result.status === 'none') conclusivePrefixes.push(groupPrefix(result));
    if (result.status !== 'available') continue;
    for (const slot of result.slots) {
      const key = slotKey(result, slot);
      present.add(key);
      if (!(key in state.alerted) && !seen.has(key)) {
        seen.add(key);
        newSlots.push({ key, result, slot });
      }
    }
  }

  const goneKeys = Object.keys(state.alerted).filter(
    (key) => !present.has(key) && conclusivePrefixes.some((prefix) => key.startsWith(prefix)),
  );
  return { newSlots, goneKeys };
}

export function markAlerted(state, keys, now = new Date()) {
  for (const key of keys) state.alerted[key] = now.toISOString();
}

export function clearGone(state, goneKeys) {
  for (const key of goneKeys) delete state.alerted[key];
}

const unparsedKey = (result) => `${result.target.slug}|${result.date}|${result.partySize}`;

export function shouldAlertUnparsed(state, result, now = new Date()) {
  const last = state.unparsedAlertedAt[unparsedKey(result)];
  return !last || now - new Date(last) > UNPARSED_REALERT_MS;
}

export function markUnparsedAlerted(state, result, now = new Date()) {
  state.unparsedAlertedAt[unparsedKey(result)] = now.toISOString();
}

// Call once per run. Returns which health messages to send.
export function updateHealth(state, { hadErrors }) {
  if (hadErrors) {
    state.consecutiveErrorRuns += 1;
    if (state.consecutiveErrorRuns >= ERROR_RUNS_BEFORE_ALERT && !state.errorAlertSent) {
      state.errorAlertSent = true;
      return { alertFailing: true, alertRecovered: false };
    }
    return { alertFailing: false, alertRecovered: false };
  }
  const alertRecovered = state.errorAlertSent;
  state.consecutiveErrorRuns = 0;
  state.errorAlertSent = false;
  return { alertFailing: false, alertRecovered };
}

export function todayInNewYork(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(now);
}

function hourInNewYork(now) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, hour: 'numeric', hourCycle: 'h23' }).format(now));
}

// The first successful run each day at or after 09:00 New York time sends the heartbeat and canary.
export function heartbeatDue(state, now = new Date()) {
  return hourInNewYork(now) >= HEARTBEAT_HOUR && state.lastHeartbeatDate !== todayInNewYork(now);
}

export function addDays(dateString, days) {
  const d = new Date(`${dateString}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

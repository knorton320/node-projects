const MIN_MINUTES = 1;
const MAX_MINUTES = 60;
const JITTER_MINUTES = 2;

// How long the watcher sleeps before the next run: the interval, plus or minus a random 0-2
// minutes (never under 1 minute), doubled for every run in a row that had errors, capped at 60.
export function nextSleepMs({ intervalMin, consecutiveErrorRuns = 0, random = Math.random }) {
  const jitter = (random() * 2 - 1) * JITTER_MINUTES;
  const minutes = Math.max(MIN_MINUTES, intervalMin + jitter) * 2 ** consecutiveErrorRuns;
  return Math.min(MAX_MINUTES, minutes) * 60_000;
}

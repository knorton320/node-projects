import { formatResultLine, runOnce } from '../src/check.js';
import { bookingUrl, loadConfig } from '../src/config.js';
import { loadPage, openSession } from '../src/browser.js';
import { enableFileLog, log } from '../src/log.js';
import { nextSleepMs } from '../src/schedule.js';

const config = loadConfig();
if (config.targets.length === 0) {
  console.error('No enabled targets in config/targets.json');
  process.exit(1);
}

enableFileLog('local/logs/watch.log');

const intervalMin = Number(process.env.CHECK_INTERVAL_MIN) || 8;
const url = bookingUrl(config.targets[0]);
const ERROR_RUNS_BEFORE_RESTART = 3;

let stopping = false;
let wake = null;

function onSignal(signal) {
  if (stopping) {
    log.warn(`${signal} again; exiting now`);
    process.exit(1);
  }
  stopping = true;
  log.info(`${signal} received; finishing up`);
  wake?.();
}
process.on('SIGINT', () => onSignal('SIGINT'));
process.on('SIGTERM', () => onSignal('SIGTERM'));

// Sleeps, but wakes straight away on SIGINT/SIGTERM.
function sleepUnlessStopped(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    wake = () => {
      clearTimeout(timer);
      resolve();
    };
  });
}

const openBrowser = () => openSession({
  headless: process.env.HEADLESS === 'true',
  profileDir: process.env.PROFILE_DIR || 'local/profile',
  storageState: process.env.STORAGE_STATE || undefined,
  url,
});

log.info('Watcher started', { intervalMin, targets: config.targets.length });

let session = null;
let consecutiveErrorRuns = 0;
for (let run = 1; !stopping; run++) {
  // One browser session is kept between runs; each run just reloads the booking page, which also
  // refreshes the Authorization header the API calls need.
  let openError = null;
  try {
    if (!session) session = await openBrowser();
    else await loadPage(session.page, url);
  } catch (err) {
    openError = err.message;
    log.error('Could not load the booking page', { message: err.message });
    await session?.close().catch(() => {});
    session = null;
  }

  const { results, hadErrors, firstError } = await runOnce({ config, page: session?.page, openError });
  if (results.length === 0 && firstError) log.warn(`Run ${run}: ${firstError}`);
  for (const result of results) log.info(`Run ${run}: ${formatResultLine(result)}`);

  consecutiveErrorRuns = hadErrors ? consecutiveErrorRuns + 1 : 0;
  if (hadErrors && consecutiveErrorRuns % ERROR_RUNS_BEFORE_RESTART === 0 && session) {
    log.warn(`${consecutiveErrorRuns} error runs in a row; restarting the browser`);
    await session.close().catch(() => {});
    session = null;
  }
  if (stopping) break;

  const sleepMs = nextSleepMs({ intervalMin, consecutiveErrorRuns });
  log.info(`Run ${run} done (${hadErrors ? 'with errors' : 'ok'}); next run in ${(sleepMs / 60_000).toFixed(1)} min`);
  await sleepUnlessStopped(sleepMs);
}

await session?.close().catch(() => {});
log.info('Watcher stopped');
process.exit(0);

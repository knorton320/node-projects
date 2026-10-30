import { runCheck, formatResultLine } from '../src/check.js';
import { bookingUrl, loadConfig } from '../src/config.js';
import { openSession } from '../src/browser.js';
import { log } from '../src/log.js';

const config = loadConfig();
if (config.targets.length === 0) {
  console.error('No enabled targets in config/targets.json');
  process.exit(1);
}

let session;
let exitCode = 0;
try {
  session = await openSession({
    headless: process.env.HEADLESS === 'true',
    profileDir: process.env.PROFILE_DIR || 'local/profile',
    storageState: process.env.STORAGE_STATE || undefined,
    url: bookingUrl(config.targets[0]),
  });
  const { results, hadErrors } = await runCheck({ config, page: session.page });
  for (const result of results) console.log(formatResultLine(result));
  if (hadErrors) exitCode = 1;
} catch (err) {
  log.error('Check failed', { message: err.message });
  console.log(`ERROR  ${err.message}`);
  exitCode = 1;
} finally {
  await session?.close();
}
process.exit(exitCode);

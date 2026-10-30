import { runOnce, formatResultLine } from '../src/check.js';
import { bookingUrl, loadConfig } from '../src/config.js';
import { openSession } from '../src/browser.js';
import { log } from '../src/log.js';

const config = loadConfig();
if (config.targets.length === 0) {
  console.error('No enabled targets in config/targets.json');
  process.exit(1);
}

let session;
let openError = null;
try {
  session = await openSession({
    headless: process.env.HEADLESS === 'true',
    profileDir: process.env.PROFILE_DIR || 'local/profile',
    storageState: process.env.STORAGE_STATE || undefined,
    url: bookingUrl(config.targets[0]),
  });
} catch (err) {
  log.error('Could not open the browser session', { message: err.message });
  openError = err.message;
}

const { results, hadErrors, firstError } = await runOnce({ config, page: session?.page, openError });
if (results.length === 0 && firstError) console.log(`ERROR  ${firstError}`);
for (const result of results) console.log(formatResultLine(result));

await session?.close();
process.exit(hadErrors ? 1 : 0);

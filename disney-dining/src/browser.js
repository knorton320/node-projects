import { chromium } from 'playwright';
import { trackAuthorization } from './disney-api.js';
import { log } from './log.js';

const COOKIE_SELECTORS = [
  '#onetrust-accept-btn-handler',
  '[data-testid="cookie-accept"]',
  'button[aria-label*="Accept"]',
];
const QUEUE_POLL_MS = 5000;
const QUEUE_TIMEOUT_MS = 10 * 60 * 1000;

export class QueueTimeoutError extends Error {
  constructor(message = 'Timed out waiting in the Queue-it waiting room') {
    super(message);
    this.name = 'QueueTimeoutError';
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function backOnDine(url) {
  try {
    const u = new URL(url);
    return u.hostname === 'disneyworld.disney.go.com' && u.pathname.startsWith('/dine-res/');
  } catch {
    return false;
  }
}

// Waits out the Queue-it waiting room if the page landed in one.
export async function waitOutQueue(page) {
  if (!page.url().includes('queue-it.net')) return;
  log.info('In Queue-it waiting room');
  const deadline = Date.now() + QUEUE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(QUEUE_POLL_MS);
    if (backOnDine(page.url())) return;
  }
  throw new QueueTimeoutError();
}

async function acceptCookies(page) {
  for (const selector of COOKIE_SELECTORS) {
    const button = page.locator(selector).first();
    try {
      await button.waitFor({ state: 'visible', timeout: 3000 });
      await button.click();
      log.debug('Accepted cookie banner', { selector });
      return;
    } catch {
      // not present, try the next selector
    }
  }
}

// Navigates to `url`, then handles Queue-it, the cookie banner and page load.
export async function loadPage(page, url) {
  trackAuthorization(page);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitOutQueue(page);
  await acceptCookies(page);
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
}

export async function openSession({ headless, profileDir, storageState, url }) {
  const opts = {
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
  };
  // Playwright's own signal handlers close the browser and then kill the process (exit code 130),
  // which would pre-empt the watcher's clean shutdown. Our scripts handle SIGINT/SIGTERM themselves.
  const launchOpts = { headless, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false };

  let browser = null;
  let context;
  if (storageState) {
    browser = await chromium.launch(launchOpts);
    context = await browser.newContext({ storageState, ...opts });
  } else {
    context = await chromium.launchPersistentContext(profileDir, { ...launchOpts, ...opts });
  }

  const close = async () => {
    await context.close();
    if (browser) await browser.close();
  };

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await loadPage(page, url);
    return { context, page, close };
  } catch (err) {
    await close().catch(() => {});
    throw err;
  }
}

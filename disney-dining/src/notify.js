import { bookingUrl } from './config.js';
import { log } from './log.js';
import { PLUTO_DELIVERY } from './pluto.js';

const EMBED_FIELD_LIMIT = 1000;
const PUSHOVER_URL = 'https://api.pushover.net/1/messages.json';
const PUSHOVER_LIMITS = { title: 250, message: 1024, url: 512, urlTitle: 100 };
const PUSHOVER_MIN_RETRY_SEC = 30;
const PUSHOVER_MAX_EXPIRE_SEC = 10800;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Posts to the Discord webhook. Never throws, so alerting can't crash a check. The webhook URL is
// a secret: it is never logged.
export async function sendDiscord({ content, embeds } = {}) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) {
    log.warn('DISCORD_WEBHOOK_URL is not set; skipping Discord message');
    return false;
  }

  const post = () => fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content, embeds }),
  });

  try {
    let res = await post();
    if (res.status === 429) {
      const body = await res.json().catch(() => ({}));
      const retryAfter = Number(body.retry_after) || 1;
      log.warn('Discord rate limited; retrying once', { retryAfterSeconds: retryAfter });
      await sleep(retryAfter * 1000);
      res = await post();
    }
    if (!res.ok) {
      log.error('Discord webhook failed', { status: res.status, body: (await res.text().catch(() => '')).slice(0, 200) });
      return false;
    }
    return true;
  } catch (err) {
    log.error('Discord webhook error', { message: err.message });
    return false;
  }
}

// Discord only pings a numeric user ID (17-20 digits), not a username.
function mentionPrefix() {
  const id = process.env.DISCORD_MENTION_USER_ID;
  if (!id) return '';
  if (!/^\d{17,20}$/.test(id)) {
    log.warn('DISCORD_MENTION_USER_ID is not a numeric Discord user ID; not mentioning anyone');
    return '';
  }
  return `<@${id}> `;
}

// Pluto delivers the message. The mention stays outside the code block so it still pings.
function withPluto(headline) {
  return `${mentionPrefix()}${headline}\n\`\`\`${PLUTO_DELIVERY}\`\`\``;
}

function slotLine(slot) {
  const name = slot.restaurantName ? ` — ${slot.restaurantName}` : '';
  const label = slot.eventLabel ? ` (${slot.eventLabel})` : '';
  return `${slot.time ?? '??:??'}${name}${label}`;
}

// Keeps the list inside a size limit (Discord's field limit unless told otherwise).
function slotList(slots, limit = EMBED_FIELD_LIMIT) {
  const lines = [];
  let length = 0;
  for (const [i, slot] of slots.entries()) {
    const line = slotLine(slot);
    if (length + line.length + 1 > limit) {
      lines.push(`…and ${slots.length - i} more`);
      break;
    }
    lines.push(line);
    length += line.length + 1;
  }
  return lines.join('\n') || 'none';
}

// `result` is a check result: { target, date, partySize, slots }.
export function formatAvailabilityAlert(result, now = new Date()) {
  return {
    content: withPluto('Pluto has a dining reservation for you. Book now!'),
    embeds: [{
      title: `🍽️ OPEN: ${result.target.name}`,
      url: bookingUrl(result.target),
      fields: [
        { name: 'Date', value: result.date, inline: true },
        { name: 'Party size', value: String(result.partySize), inline: true },
        { name: 'Times', value: slotList(result.slots) },
      ],
      footer: { text: `Checked ${now.toISOString()}` },
    }],
  };
}

export function formatUnparsedAlert(result, now = new Date()) {
  return {
    content: withPluto('Pluto thinks something is open. Check the page now!'),
    embeds: [{
      title: `⚠️ POSSIBLY OPEN: ${result.target.name}`,
      description: "Disney returned availability but the times couldn't be read. Check the page now.",
      url: bookingUrl(result.target),
      fields: [
        { name: 'Date', value: result.date, inline: true },
        { name: 'Party size', value: String(result.partySize), inline: true },
      ],
      footer: { text: `Checked ${now.toISOString()}` },
    }],
  };
}

export function pushoverEnabled() {
  return Boolean(process.env.PUSHOVER_APP_TOKEN && process.env.PUSHOVER_USER_KEY);
}

// Posts to Pushover. Never throws, so alerting can't crash a check. The app token and user key are
// secrets: neither they nor the request body are ever logged. `expireSec` overrides
// PUSHOVER_EXPIRE_SEC (the test script uses it to stop after a few repeats).
export async function sendPushover({ title, message, url, urlTitle, priority = 2 }, { retryDelayMs = 5000, expireSec } = {}) {
  if (!pushoverEnabled()) return false;

  const body = new URLSearchParams({
    token: process.env.PUSHOVER_APP_TOKEN,
    user: process.env.PUSHOVER_USER_KEY,
    title: String(title ?? '').slice(0, PUSHOVER_LIMITS.title),
    message: String(message ?? '').slice(0, PUSHOVER_LIMITS.message),
    priority: String(priority),
  });
  if (url) {
    body.set('url', url.slice(0, PUSHOVER_LIMITS.url));
    if (urlTitle) body.set('url_title', urlTitle.slice(0, PUSHOVER_LIMITS.urlTitle));
  }
  if (priority === 2) {
    const retry = Math.max(PUSHOVER_MIN_RETRY_SEC, Number(process.env.PUSHOVER_RETRY_SEC) || PUSHOVER_MIN_RETRY_SEC);
    const expire = Math.min(PUSHOVER_MAX_EXPIRE_SEC, expireSec ?? (Number(process.env.PUSHOVER_EXPIRE_SEC) || 900));
    body.set('retry', String(retry));
    body.set('expire', String(expire));
    body.set('tags', 'disney-dining');
  }
  if (process.env.PUSHOVER_SOUND) body.set('sound', process.env.PUSHOVER_SOUND);

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(PUSHOVER_URL, { method: 'POST', body });
      const json = await res.json().catch(() => ({}));
      if (res.status === 200 && json.status === 1) {
        log.info('Pushover accepted the alert', { receipt: json.receipt });
        return true;
      }
      if (res.status < 500) {
        // Bad key or bad input: retrying the same request can't help.
        log.error('Pushover rejected the alert', { status: res.status, errors: json.errors });
        return false;
      }
      log.warn('Pushover server error', { status: res.status, attempt });
    } catch (err) {
      log.warn('Pushover request failed', { message: err.message, attempt });
    }
    if (attempt === 1) await sleep(retryDelayMs);
  }
  log.error('Pushover alert not delivered after a retry');
  return false;
}

// Push notifications show no Pluto: the ASCII art doesn't fit and doesn't render.
export function formatPushoverAvailability(result) {
  const header = `Party ${result.partySize} · ${result.date}`;
  // Leave room for a final "…and N more" line.
  const list = slotList(result.slots, PUSHOVER_LIMITS.message - header.length - 1 - 24);
  return {
    title: `🍽️ OPEN: ${result.target.name}`,
    message: `${header}\n${list}`,
    url: bookingUrl(result.target),
    urlTitle: 'Open booking page',
  };
}

export function formatPushoverUnparsed(result) {
  return {
    title: `⚠️ POSSIBLY OPEN: ${result.target.name}`,
    message: `Party ${result.partySize} · ${result.date}\nDisney returned availability but the times couldn't be read. Check the page now.`,
    url: bookingUrl(result.target),
    urlTitle: 'Open booking page',
  };
}

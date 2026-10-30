import { bookingUrl } from './config.js';
import { log } from './log.js';
import { PLUTO_DELIVERY } from './pluto.js';

const EMBED_FIELD_LIMIT = 1000;

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

// Keeps the list inside Discord's field size limit.
function slotList(slots) {
  const lines = [];
  let length = 0;
  for (const [i, slot] of slots.entries()) {
    const line = slotLine(slot);
    if (length + line.length + 1 > EMBED_FIELD_LIMIT) {
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

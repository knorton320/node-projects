// Collects every bookable time in an availability response, whatever the wrapper keys are.
// Any object whose `offers` is a map keyed by date is treated as the restaurant that owns them.
export function extractSlots(json, date) {
  const slots = [];
  const visit = (node, ctx) => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item, ctx);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const here = { ...ctx };
    if (typeof node.eventLabel === 'string') here.eventLabel = node.eventLabel;
    const offersByDate = node.offers && !Array.isArray(node.offers) && typeof node.offers === 'object' ? node.offers : null;
    if (offersByDate) {
      const restaurant = { restaurantId: String(node.id ?? '').split(';')[0] || null, restaurantName: node.name ?? null };
      for (const period of offersByDate[date] ?? []) {
        // Restaurants and dining events: period.offersByAccessibility[].offers[]
        for (const group of period.offersByAccessibility ?? []) {
          for (const offer of group.offers ?? []) {
            slots.push(makeSlot({ date, time: offer.time, label: offer.label, offerId: offer.offerId, mealPeriod: period.mealPeriodType, ...restaurant, eventLabel: here.eventLabel }));
          }
        }
        // Dinner shows: period.offerTimes[].offers[]
        for (const showTime of period.offerTimes ?? []) {
          for (const offer of showTime.offers ?? []) {
            slots.push(makeSlot({ date, time: showTime.time, label: showTime.label, offerId: offer.offerId, mealPeriod: offer.mealPeriodType, ...restaurant, eventLabel: offer.category ?? here.eventLabel }));
          }
        }
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (key !== 'offers') visit(value, here);
    }
  };
  visit(json, { eventLabel: null });
  return slots;
}

function makeSlot(s) {
  return {
    date: s.date,
    time: typeof s.time === 'string' ? s.time.slice(0, 5) : null,
    label: s.label ?? null,
    offerId: s.offerId ?? null,
    mealPeriod: s.mealPeriod ?? null,
    restaurantId: s.restaurantId ?? null,
    restaurantName: s.restaurantName ?? null,
    eventLabel: s.eventLabel ?? null,
  };
}

// The facility one-day call (confirmed in Phase 2 for restaurants) returns
// `{ restaurants: { "<date>": [meal periods] } }`: keyed directly by date, with no `offers` wrapper
// and no restaurant id or name. Any array found under the date key is read as meal periods. The
// restaurant comes from the nearest enclosing object that has both `id` and `name`, else `fallback`.
export function extractDateKeyedSlots(json, date, fallback = {}) {
  const slots = [];
  const visit = (node, ctx) => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item, ctx);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const here = { ...ctx };
    if (typeof node.eventLabel === 'string') here.eventLabel = node.eventLabel;
    if (typeof node.id === 'string' && typeof node.name === 'string') {
      here.restaurantId = node.id.split(';')[0] || null;
      here.restaurantName = node.name;
    }
    if (Array.isArray(node[date])) {
      for (const period of node[date]) {
        for (const group of period?.offersByAccessibility ?? []) {
          for (const offer of group.offers ?? []) {
            slots.push(makeSlot({ date, time: offer.time, label: offer.label, offerId: offer.offerId, mealPeriod: period.mealPeriodType, ...here }));
          }
        }
        for (const showTime of period?.offerTimes ?? []) {
          for (const offer of showTime.offers ?? []) {
            slots.push(makeSlot({ date, time: showTime.time, label: showTime.label, offerId: offer.offerId, mealPeriod: offer.mealPeriodType, ...here, eventLabel: offer.category ?? here.eventLabel }));
          }
        }
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (key !== date) visit(value, here);
    }
  };
  visit(json, {
    eventLabel: null,
    restaurantId: fallback.restaurantId ?? null,
    restaurantName: fallback.restaurantName ?? null,
  });
  return slots;
}

// Turns a raw result ({ status, url, contentType, text }) from a facility call into
// `{ status: 'available' | 'none' | 'unparsed' | 'error', slots, error? }`.
// `restaurantName` / `restaurantId` name the facility when the response doesn't (restaurant targets).
export function classifyResult(raw, { date, partySize, restaurantName = null, restaurantId = null }) {
  const fail = (reason) => ({ status: 'error', slots: [], error: reason });

  if ((raw.contentType ?? '').includes('text/html')) {
    return fail(`HTML response (blocked, or stuck in Queue-it), HTTP ${raw.status}`);
  }
  if (raw.status === 401 || raw.status === 403) {
    return fail(`HTTP ${raw.status} (login expired, or blocked)`);
  }

  if (raw.status === 404) {
    let json;
    try {
      json = JSON.parse(raw.text);
    } catch {
      return fail('HTTP 404');
    }
    return json?.errorType === 'OFFER_NOT_FOUND' ? { status: 'none', slots: [] } : fail('HTTP 404');
  }

  if (raw.status !== 200) return fail(`HTTP ${raw.status}`);

  let json;
  try {
    json = JSON.parse(raw.text);
  } catch {
    return fail('invalid JSON in HTTP 200 response');
  }

  let slots = extractSlots(json, date);
  if (slots.length === 0) slots = extractDateKeyedSlots(json, date, { restaurantId, restaurantName });
  slots = slots.map((slot) => ({ ...slot, partySize }));

  // Disney says something is open but we couldn't read the times: alert anyway.
  return { status: slots.length > 0 ? 'available' : 'unparsed', slots };
}

const BUCKETS = {
  morning: ['06:00', '11:59'],
  afternoon: ['12:00', '15:59'],
  evening: ['16:00', '23:59'],
};

function windowBounds(timeWindow) {
  if (typeof timeWindow === 'string') return BUCKETS[timeWindow];
  return [timeWindow.start, timeWindow.end];
}

// `null` keeps everything. Slots with no readable time are kept (a false alarm is cheap).
export function filterByTimeWindow(slots, timeWindow) {
  if (timeWindow == null) return slots;
  const [start, end] = windowBounds(timeWindow);
  return slots.filter((slot) => slot.time == null || (slot.time >= start && slot.time <= end));
}

// Applies the window to a classified result. An `available` result that loses every slot becomes
// `none`; `filteredOut` counts what was dropped. `unparsed` is never filtered, so it always alerts.
export function applyTimeWindow(result, timeWindow) {
  if (result.status !== 'available') return { ...result, filteredOut: 0 };
  const slots = filterByTimeWindow(result.slots, timeWindow);
  return {
    ...result,
    status: slots.length > 0 ? 'available' : 'none',
    slots,
    filteredOut: result.slots.length - slots.length,
  };
}

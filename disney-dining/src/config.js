import { readFileSync } from 'node:fs';

const ENTITY_TYPES = ['dining-event', 'restaurant'];
const BUCKETS = ['morning', 'afternoon', 'evening'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const isNonEmptyString = (v) => typeof v === 'string' && v.trim() !== '';
const isIntInRange = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

function isRealDate(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function validTimeWindow(w) {
  if (w === null) return true;
  if (typeof w === 'string') return BUCKETS.includes(w);
  if (typeof w === 'object' && !Array.isArray(w)) {
    return typeof w.start === 'string' && typeof w.end === 'string'
      && TIME_RE.test(w.start) && TIME_RE.test(w.end);
  }
  return false;
}

function validateTarget(t, label, problems) {
  if (!t || typeof t !== 'object') {
    problems.push(`${label}: must be an object`);
    return;
  }
  for (const key of ['name', 'slug', 'facilityId']) {
    if (!isNonEmptyString(t[key])) problems.push(`${label}: "${key}" must be a non-empty string`);
  }
  if (!ENTITY_TYPES.includes(t.entityType)) {
    problems.push(`${label}: "entityType" must be one of ${ENTITY_TYPES.join(', ')}`);
  }
  if (!Array.isArray(t.dates) || t.dates.length === 0) {
    problems.push(`${label}: "dates" must be a non-empty array`);
  } else {
    for (const d of t.dates) {
      if (!isRealDate(d)) problems.push(`${label}: "${d}" is not a real YYYY-MM-DD date`);
    }
  }
  if (!Array.isArray(t.partySizes) || t.partySizes.length === 0) {
    problems.push(`${label}: "partySizes" must be a non-empty array`);
  } else {
    for (const p of t.partySizes) {
      if (!isIntInRange(p, 1, 20)) problems.push(`${label}: party size ${JSON.stringify(p)} must be an integer 1-20`);
    }
  }
  if (!validTimeWindow(t.timeWindow)) {
    problems.push(`${label}: "timeWindow" must be null, ${BUCKETS.join('|')}, or {start, end} as HH:MM`);
  }
  if (typeof t.enabled !== 'boolean') problems.push(`${label}: "enabled" must be a boolean`);
}

function validateCanary(c, problems) {
  const label = 'canary';
  if (!c || typeof c !== 'object') {
    problems.push(`${label}: must be an object`);
    return;
  }
  for (const key of ['name', 'facilityId']) {
    if (!isNonEmptyString(c[key])) problems.push(`${label}: "${key}" must be a non-empty string`);
  }
  if (!ENTITY_TYPES.includes(c.entityType)) {
    problems.push(`${label}: "entityType" must be one of ${ENTITY_TYPES.join(', ')}`);
  }
  if (!isIntInRange(c.partySize, 1, 20)) problems.push(`${label}: "partySize" must be an integer 1-20`);
  if (!isIntInRange(c.daysAhead, 1, 59)) problems.push(`${label}: "daysAhead" must be an integer 1-59`);
}

export function loadConfig(path = 'config/targets.json') {
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`Could not read config ${path}: ${err.message}`);
  }

  const problems = [];
  if (!Array.isArray(raw?.targets)) {
    problems.push('"targets" must be an array');
  } else {
    raw.targets.forEach((t, i) => validateTarget(t, `targets[${i}]${t?.name ? ` (${t.name})` : ''}`, problems));
  }
  if (raw?.canary != null) validateCanary(raw.canary, problems);

  if (problems.length > 0) {
    throw new Error(`Invalid config ${path}:\n- ${problems.join('\n- ')}`);
  }

  return {
    targets: raw.targets.filter((t) => t.enabled),
    canary: raw.canary ?? null,
  };
}

export function bookingUrl(target) {
  return `https://disneyworld.disney.go.com/dine-res/${target.entityType}/${target.slug}/`;
}

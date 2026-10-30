import { loadConfig } from '../src/config.js';

function describeWindow(w) {
  if (w === null) return 'any time';
  if (typeof w === 'string') return w;
  return `${w.start}-${w.end}`;
}

try {
  const { targets, canary } = loadConfig();
  for (const t of targets) {
    console.log(`OK  ${t.name} | ${t.dates.join(',')} | party ${t.partySizes.join(',')} | ${describeWindow(t.timeWindow)}`);
  }
  if (canary) {
    console.log(`OK  canary ${canary.name} | party ${canary.partySize} | ${canary.daysAhead} days ahead`);
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

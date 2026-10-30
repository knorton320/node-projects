# Disney Dining Availability Checker

Checks whether a Walt Disney World dining reservation is open for a given date and party size,
and alerts on Discord when something opens. Config lives in `config/targets.json`.

```bash
npm install
npx playwright install chromium
cp .env.example .env
npm run validate-config
npm test
```

Check once, or watch continuously (keeps the Mac awake while it runs; Ctrl+C to stop):

```bash
npm run check
caffeinate -i npm run watch
```

See [PLAN.md](PLAN.md) for the phases.

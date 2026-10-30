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

See [PLAN.md](PLAN.md) for the phases.

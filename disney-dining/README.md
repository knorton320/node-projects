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

## Wake-up alerts (Pushover)

Availability and "possibly open" alerts also go to [Pushover](https://pushover.net) at emergency
priority, which rings through silent mode and Sleep Focus (turn on Critical Alerts in the Pushover
app) and repeats until you acknowledge it. Health, heartbeat and canary messages stay Discord-only.
Put these in `.env` (leave both empty to turn it off):

```
PUSHOVER_APP_TOKEN=<API Token/Key of your Pushover application>
PUSHOVER_USER_KEY=<User Key from the pushover.net dashboard>
PUSHOVER_SOUND=            # optional, for example persistent or siren
```

Send a test (rings for about 2 minutes unless you acknowledge it), then restart the watcher so it
picks the keys up:

```bash
npm run test-pushover
```

See [PLAN.md](PLAN.md) for the phases.

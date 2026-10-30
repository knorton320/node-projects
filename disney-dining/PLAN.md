# Disney Dining Availability Checker: Plan and Runbook

Goal: check whether a Walt Disney World dining reservation is open for a given date and party
size, run the check in the background, and alert on Discord when something opens. Later phases
hold (freeze) the slot so the user can finish checkout fast.

This file is both the plan and the runbook. A session told "Execute Phase N" should be able to
do that phase using only this file and the repo.

---

## How to execute a phase (read first, every session)

1. **Read this whole file before doing anything.** Then read the **Progress log** at the bottom
   to see what earlier sessions finished and anything they flagged.
2. **Only work on the phase you were asked for.** Don't start the next phase, even if it looks easy.
3. **Check the phase's "Requires" line.** If an earlier phase's Done-when checks aren't met, stop
   and report that instead of working around it.
4. **Work through the tasks in order.** After each task, change its `- [ ]` to `- [x]` in this file.
5. **🛑 USER STOP** means stop working, tell the user exactly what they need to do, and wait for
   their reply. Never try to do a USER STOP step yourself (logging in, creating webhooks, SSH
   setup, payment).
6. **Run every Verify command** and confirm the output matches before you tick the task.
7. **When reality doesn't match this plan, stop and report.** This includes a different API shape,
   an endpoint that errors, or a command that fails twice. Don't invent a new approach. Small
   fixes, like a typo or a missing import, are fine.
8. **At the end of the phase**, add an entry to the Progress log with the date, what was done,
   what was verified, and anything surprising. Then stop.
9. **Never `git commit` or `git push`** unless the user asks.

### Global rules (all phases)

- **Working directory:** `/Users/kylenorton/Repos/node-projects/disney-dining`. Run every command
  from there unless a task says otherwise.
- **Never commit or print secrets.** That covers `.env`, `local/` (browser profile, cookies,
  state), and `*.har`. The repo's root `.gitignore` already ignores `.env`, `*/local/` and `*.har`.
- **Disney request budget during development:** wait at least **5 seconds** between Disney API
  calls and make **no more than 20 API calls per script run**. Never write a loop that hits Disney
  faster. This protects the user's account.
- **Never handle the user's Disney password or payment card.** Login is always manual, in a
  visible browser window.
- **Never call `api/freeze`, `api/validate`, `api/thaw`, or anything under `/dine-res/reservation`**
  outside Phase 6.
- **Don't modify `../../mouse-mcp`.** You may read it for reference.
- **Code style:** plain JavaScript, ES modules (`import`/`export`), Node 24 built-ins over npm
  packages where reasonable. Use `node:test` for tests, `--env-file-if-exists` instead of dotenv,
  and global `fetch` for Discord. The only runtime dependency is `playwright`.

---

## Target (current)

| Field | Value |
|---|---|
| Name | EPCOT Candlelight Processional Dinner Package |
| Booking page | https://disneyworld.disney.go.com/dine-res/dining-event/candlelight-dinner-packages/ |
| `slug` (urlFriendlyId) | `candlelight-dinner-packages` |
| `facilityId` | `17736025` |
| `entityType` | `dining-event` |
| Date | `2026-12-11` |
| Party sizes | `4` (preferred), `2` (also acceptable). Check both. |
| Time window | none (any time) |
| Restaurant | any restaurant included in the package |

Bookable window when captured: 2026-10-24 → 2026-12-23 (60 days out), so Dec 11 is bookable now.

---

## Decisions (2026-10-24)

1. **Targets:** the config supports dining events and regular restaurants (`entityType`). The only
   target for now is Candlelight.
2. **Dates and times:** each target has a list of dates and an optional time window. Only matching
   slots alert.
3. **Language:** plain JavaScript, ESM.
4. **Hosting:** Mac first, then the Oracle Cloud VM running one check per cron run, if Disney
   doesn't block it.
5. **Booking:** Option B. The script freezes (holds) the slot and pings Discord, and the user
   finishes checkout. See the Phase 6 caveat about where the hold lives.
6. **Dedicated checker account:** the script only ever logs in with a separate Disney account
   (its own Gmail, **accurate** personal details, no made-up birthday). The user's main account,
   which holds tickets and the trip, is never logged into the script's browser. Default flow:
   the script checks on the dedicated account, and when an alert fires, the user books by hand
   on their main account. Automated holds (Phase 6) are tested on the dedicated account first.

---

## API reference (from two HAR captures and the site's JS)

All endpoints are same-origin on `https://disneyworld.disney.go.com`. All are called **from inside
the Playwright page** (see "How requests are made").

| Purpose | Request | Notes |
|---|---|---|
| Entity details | `GET /dine-res/api/dine-detail/{slug}?entityType={entityType}` | `X-Function-Name: getFacilityDetails`. Returns `id` = `17736025;entityType=dining-event`. |
| Season calendar | `GET /dine-res/api/calendar-days?facilityId=17736025&entityType=dining-event` | `X-Function-Name: getCalendarDays`. **Not inventory:** it lists event season days, not open tables. Don't use it to decide availability. |
| **Availability, one day** | `GET /dine-res/api/availability/{partySize}/{YYYY-MM-DD}?facilityId=17736025;entityType=dining-event&entityType=dining-event` | `X-Function-Name: getAvailability`. The core check. |
| Availability, date range | `GET /dine-res/api/availability/{partySize}/{start},{end}?facilityId=17736025;entityType=dining-event&entityType=dining-event` | Up to 10 days per call (`dateRangeLimit=10`). |
| Calendar indicator | `POST /dine-res/api/v1/availability-indicator`, JSON body `{"enterpriseId":"17736025","entityType":"dining-event","partySize":4,"dateRange":{"startDate":"2026-12-11","endDate":"2026-12-11"}}` | `X-Function-Name: getCalendarAvailability`. Unverified: the exact `enterpriseId` format is a guess. |
| Logged-in check | `GET /api/navigation/profile?isUser=true&brand=wdw&locale=en-us&userType=GUEST` | Returned a `user` object with an avatar when logged in. Logged-out shape unknown. |
| Booking (Phase 6 only) | `POST /dine-res/api/freeze/{offerId}`, `PUT /dine-res/api/validate/{offerId}`, `DELETE /dine-res/api/thaw/{offerId}`, then page `/dine-res/reservation` | Request and response shapes unknown. |

**The query string is unusual. Copy it exactly.** `facilityId` contains a literal `;` and `=`, and
`entityType` appears twice. Build the URL as a plain template string. **Don't use
`URLSearchParams`**, because it would encode `;` and `=` differently from the site.

**"No availability" response:** HTTP **404** with this JSON body. Treat it as "none", not as an error.

```json
{"conversationId":"…","correlationId":"…","errorType":"OFFER_NOT_FOUND","errorCode":"9010",
 "errorMessage":"WARN: GET_OFFERS DINING-EVENT: Offers not found for dine events 17736025.",
 "statusCode":404,"error":"Request failed with status code 404"}
```

**Success response:** not seen yet. The site's JS suggests it contains `diningEvents`,
`dinnerShows` or `restaurants`, keyed by facility, with dining events holding `eventTimes[]`.
Phase 2 captures a real one.

**Headers the site sends on every `/dine-res/api/` call:**

```
accept: application/json, text/plain, */*
x-function-name: <per endpoint, see table>
x-conversation-id: <one UUID per browser session>
x-correlation-id: <new UUID per request>
x-disney-internal-dine-vas-365: true
x-disney-internal-dine-vas-eks: true
```

**Protection:**
- **Akamai Bot Manager** runs on the site. Plain Node `fetch` with copied cookies will very likely
  be blocked.
- A **Queue-it waiting room** sits in front of `/dine-res/`. The first page load may redirect to
  `disneyparks.queue-it.net` and come back with `?queueittoken=…`.
- **OneTrust cookie banner.** Selectors, from `../../mouse-mcp/src/clients/session-manager.ts`:
  `#onetrust-accept-btn-handler`, `[data-testid="cookie-accept"]`, `button[aria-label*="Accept"]`.

**Site config** (`GET /dine-res/api/app-config/`): time zone `America/New_York`, `maxPartySize=20`,
`maxCalendarDays=60`, time buckets `morning 6-12 | afternoon 12-16 | evening 16-24`.

---

## How requests are made (key design)

1. Launch Chromium with Playwright using a **persistent profile** at `local/profile/`. The user logs
   in there once, by hand, and the profile keeps the login between runs.
2. Open the target's booking page. Accept the cookie banner, and wait out Queue-it if it appears.
3. Make API calls with `page.evaluate(() => fetch(...))`, so the browser supplies the cookies,
   Akamai tokens and login. Reference helper (put it in `src/disney-api.js`):

```js
// Runs fetch inside the Disney page so cookies and bot-protection tokens are included.
export async function apiRequest(page, { method = 'GET', path, functionName, body }) {
  return page.evaluate(async ({ method, path, functionName, body }) => {
    window.__dineConversationId ??= crypto.randomUUID();
    const res = await fetch(path, {
      method,
      credentials: 'include',
      headers: {
        accept: 'application/json, text/plain, */*',
        'x-function-name': functionName,
        'x-conversation-id': window.__dineConversationId,
        'x-correlation-id': crypto.randomUUID(),
        'x-disney-internal-dine-vas-365': 'true',
        'x-disney-internal-dine-vas-eks': 'true',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return {
      status: res.status,
      url: res.url,
      contentType: res.headers.get('content-type') ?? '',
      text: await res.text(),
    };
  }, { method, path, functionName, body });
}
```

## Project layout (target end state)

```
disney-dining/
  PLAN.md               this file
  README.md             how to run (short)
  package.json
  .env.example
  config/targets.json
  src/
    config.js           load + validate config/targets.json            (Phase 1)
    log.js              tiny timestamped logger                         (Phase 1)
    browser.js          launch profile, open page, consent, Queue-it    (Phase 2)
    disney-api.js       apiRequest + endpoint helpers                   (Phase 2)
    parse.js            raw response -> normalized slots                (Phase 3)
    check.js            one full run over all targets                   (Phase 3)
    state.js            dedupe + health counters in local/state.json    (Phase 4)
    notify.js           Discord webhook                                 (Phase 4)
  scripts/
    validate-config.js  (Phase 1)
    login.js            opens a visible browser for manual login        (Phase 2)
    record.js           records /dine-res/api/ traffic while user clicks (Phase 2)
    spike.js            calls each endpoint once, saves raw output      (Phase 2)
    run-check.js        CLI for `npm run check`                         (Phase 3)
    test-alert.js       sends one test Discord message                  (Phase 4)
    watch.js            long-running loop                               (Phase 5)
    export-session.js   writes local/storage-state.json for the VM      (Phase 5)
  test/
    fixtures/           sanitized real API responses (from Phase 2)
    *.test.js           node:test tests (no network)
  docs/api-notes.md     confirmed API shapes (from Phase 2)
  local/                gitignored: profile/, raw/, logs/, state.json, storage-state.json
```

---

## Phase 0: Discovery ✅

- [x] Capture HARs of the search flow (two captures, no openings found).
- [x] Decide the target, dates, party sizes and time window (see Target).
- [x] Answer the open questions (see Decisions).

---

## Phase 1: Project scaffold

**Requires:** nothing. **Touches Disney:** no.

- [ ] **1.1 Create `package.json`** in `disney-dining/` with exactly these fields:
  ```json
  {
    "name": "disney-dining",
    "version": "0.1.0",
    "private": true,
    "type": "module",
    "description": "Watches Disney World dining availability and alerts on Discord",
    "engines": { "node": ">=24" },
    "scripts": {
      "validate-config": "node scripts/validate-config.js",
      "test": "node --test"
    }
  }
  ```
  Later phases add more scripts. Each one uses the form `node --env-file-if-exists=.env scripts/<name>.js`.
- [ ] **1.2 Install Playwright:** `npm install playwright`, then `npx playwright install chromium`.
- [ ] **1.3 Create `.env.example`** with each variable and a comment:
  ```
  # Show the browser window (true while developing, false for cron)
  HEADLESS=false
  # Browser profile folder that holds the Disney login
  PROFILE_DIR=local/profile
  # Optional: use a storageState JSON instead of a profile (for the Oracle VM)
  STORAGE_STATE=
  # Discord webhook URL (Phase 4)
  DISCORD_WEBHOOK_URL=
  # Optional Discord user ID to @mention on availability alerts
  DISCORD_MENTION_USER_ID=
  # Minutes between checks in watch mode (Phase 5)
  CHECK_INTERVAL_MIN=8
  # debug | info | warn | error
  LOG_LEVEL=info
  ```
  Then copy it: `cp .env.example .env`.
- [ ] **1.4 Create `config/targets.json`:**
  ```json
  {
    "targets": [
      {
        "name": "EPCOT Candlelight Processional Dinner Package",
        "slug": "candlelight-dinner-packages",
        "facilityId": "17736025",
        "entityType": "dining-event",
        "dates": ["2026-12-11"],
        "partySizes": [4, 2],
        "timeWindow": null,
        "enabled": true
      }
    ]
  }
  ```
  `timeWindow` is `null`, one of `"morning" | "afternoon" | "evening"`, or `{ "start": "17:00", "end": "20:00" }`
  (24-hour clock, park local time).
- [ ] **1.5 Create `src/log.js`.** It exports `log.debug/info/warn/error(msg, data?)`, which print
  `ISO-timestamp LEVEL msg {json}` and respect `LOG_LEVEL`.
- [ ] **1.6 Create `src/config.js`.** It exports `loadConfig(path = 'config/targets.json')`, which reads
  and parses the file and validates every target. Collect all problems, then throw one error that
  lists them:
  - `name`, `slug`, `facilityId` are non-empty strings
  - `entityType` is `"dining-event"` or `"restaurant"`
  - `dates` is a non-empty array of `YYYY-MM-DD` strings that are real calendar dates
  - `partySizes` is a non-empty array of integers 1–20
  - `timeWindow` is valid as described in 1.4
  - `enabled` is a boolean

  It returns `{ targets }` with only the enabled targets.
- [ ] **1.7 Create `scripts/validate-config.js`.** It calls `loadConfig()` and prints one line per
  target, like `OK  EPCOT Candlelight… | 2026-12-11 | party 4,2 | any time`. On error it prints the
  message and exits with code 1.
- [ ] **1.8 Create `test/config.test.js`** with `node:test` and `node:assert/strict`:
  - the real `config/targets.json` loads
  - a bad date (`2026-02-30`), party size `0`, an unknown `entityType` and a bad `timeWindow` each throw

  Write the bad configs to a temp folder with `fs.mkdtempSync(path.join(os.tmpdir(), 'dd-'))`.
- [ ] **1.9 Create `README.md`**, 15 lines at most: what the project is, `npm install`, `npx playwright install chromium`,
  `cp .env.example .env`, `npm run validate-config`, `npm test`, and "see PLAN.md for phases".
- [ ] **1.10 Verify:**
  - `npm run validate-config` prints one `OK` line for Candlelight.
  - `npm test` passes all tests.
  - From the repo root, `git status --porcelain disney-dining` shows no `.env`, `local/` or `node_modules/`.

**Done when:** all three Verify checks pass. Add a Progress log entry, then stop.

---

## Phase 2: Browser session and API spike

**Requires:** Phase 1 done. **Touches Disney:** yes. Follow the request budget.
**Purpose:** prove that requests from inside the page work, and capture real response shapes
(including a **successful** one) so Phase 3 can be built against real data.

- [ ] **2.1 Create `src/browser.js`.** It exports `openSession({ headless, profileDir, storageState, url })`,
  which returns `{ context, page, close }`.
  - If `storageState` is set: `chromium.launch({ headless })`, then `browser.newContext({ storageState, ...opts })`.
    Otherwise: `chromium.launchPersistentContext(profileDir, { headless, ...opts })`.
  - `opts`: `viewport 1920x1080`, `locale 'en-US'`, `timezoneId 'America/New_York'`.
  - `page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })`.
  - **Queue-it:** if `page.url()` contains `queue-it.net`, log `"In Queue-it waiting room"`. Every
    5 s, check whether the URL is back on `disneyworld.disney.go.com` with a path starting
    `/dine-res/`. Give up after **10 minutes** and throw `QueueTimeoutError`.
  - **Cookie banner:** try each OneTrust selector (see API reference) with a 3 s timeout, and click
    the first one that is visible. If none appears, that's fine.
  - Wait for `networkidle`, with a 30 s timeout. A timeout here is fine; just continue.
  - Also export `isLoggedIn(page)`. It calls the logged-in check endpoint and returns `true` if
    the JSON has a `user` object. Phase 2.6 confirms this works.
- [ ] **2.2 Create `src/disney-api.js`.** Include `apiRequest` exactly as in "How requests are made",
  plus these helpers. Each returns `{ status, json, text }`, where `json` is `null` if parsing fails.
  - `getAvailability(page, { facilityId, entityType, partySize, date })`, using the one-day URL from the API reference.
  - `getAvailabilityRange(page, { …, startDate, endDate })`, using the date-range URL.
  - `getAvailabilityIndicator(page, { facilityId, entityType, partySize, startDate, endDate })`, a POST.
  - `getDineDetail(page, { slug, entityType })`.
- [ ] **2.3 Create `scripts/login.js`** (npm script `login`). It opens the target's booking page with
  `headless: false` and the persistent profile. It prints: *"Log in to My Disney Experience in the
  browser window. Press Enter here when the page shows you as signed in."* It waits for Enter
  (use `node:readline`), prints the result of `isLoggedIn`, then closes.
- [ ] **2.4 🛑 USER STOP (login):** ask the user to run `npm run login` and sign in by hand with
  the **dedicated checker account, not their main Disney account** (see Decision 6). Wait for
  them to confirm it printed `true`. If they don't have the dedicated account yet, wait while
  they create it.
- [ ] **2.5 Create `scripts/record.js`** (npm script `record`). It opens a visible browser with the
  profile at `https://disneyworld.disney.go.com/dine-res/`. It saves every response whose URL
  contains `/dine-res/api/` (skip `ui-log`) to
  `local/raw/record-<timestamp>-<n>-<last-path-segment>.json`, as
  `{ url, method, status, requestHeaderNames, requestBody, responseText }`. It runs until the user
  presses Enter, then prints how many files it saved. Use `page.on('response')` and
  `response.request()`.
- [ ] **2.6 🛑 USER STOP (record a successful search):** ask the user to run `npm run record`. In
  the browser window, they should:
  1. Search a regular table-service restaurant that has open times (for example, any restaurant
     with plenty of availability on a weekday next month) and view its times.
  2. Open the Candlelight page and check Dec 11 for party sizes 4 and 2.
  3. **Not click on a time slot.** Clicking would hold it.

  Then they press Enter in the terminal.
- [ ] **2.7 Create `scripts/spike.js`** (npm script `spike`). For the Candlelight target, it makes
  **these calls only**, 5 s apart, and saves each raw result to `local/raw/spike-<name>.json`:
  1. `getDineDetail`
  2. `getAvailability`, party 4, `2026-12-11`
  3. `getAvailabilityRange`, party 4, `2026-12-07` to `2026-12-16`
  4. `getAvailabilityIndicator`, party 4, `2026-11-27` to `2026-12-23`, with `enterpriseId: "17736025"`
  5. Only if call 4 returns 4xx: retry it once with `enterpriseId: "17736025;entityType=dining-event"`
  6. `isLoggedIn`

  For each call it prints one summary line: name, HTTP status, and the first 150 characters of the body.
- [ ] **2.8 Run `npm run spike`** with `HEADLESS=false`, then again with `HEADLESS=true`.
  - Note whether headless gets blocked: HTML instead of JSON, a 403, or a Queue-it loop.
- [ ] **2.9 Logged-out test:** run `PROFILE_DIR=local/profile-anon npm run spike` once. Note whether
  availability calls work without a login.
- [ ] **2.10 Write `docs/api-notes.md`.** Base it on the files in `local/raw/`. For each endpoint,
  record: the URL pattern, the status codes seen, and an **abbreviated JSON example** of each
  response kind (success with times, none/404, error). For the success response, name the field
  paths that hold:
  - the time of each slot
  - the restaurant name, for dining events
  - a slot or offer ID (needed in Phase 6)
  - the party size

  Also record:
  - which `enterpriseId` format worked, and what the indicator response looks like
  - whether login is required
  - whether headless works
  - whether Queue-it appeared
- [ ] **2.11 Save fixtures to `test/fixtures/`.** Copy one real success response and one real 404
  response for each endpoint you got them from (`availability-success-restaurant.json`,
  `availability-none-dining-event.json`, `indicator-*.json`, and so on). **Sanitize first:** search
  each file for `@`, `swid`, `{`-wrapped GUIDs, `firstName`, `lastName`, `email` and `phone`, and
  replace any personal values with `"REDACTED"`.
- [ ] **2.12 Verify:**
  - `docs/api-notes.md` has a success example with times.
  - `test/fixtures/` has at least one success and one none fixture.
  - `npm test` still passes.

**Done when:** the Verify checks pass. If no success response was captured, or every in-page call
was blocked, **stop and report**, because Phase 3 can't proceed. Add a Progress log entry that
summarizes the answers from 2.10.

---

## Phase 3: One-shot check

**Requires:** Phase 2 done, and `test/fixtures/` contains a success fixture. **Touches Disney:** yes
in 3.5 only.

- [ ] **3.1 Create `src/parse.js`.** It exports `parseAvailability(rawResult, target, partySize, date)`.
  It returns `{ status: 'available' | 'none' | 'error', slots, error? }`, where each slot is
  `{ date, time: 'HH:MM', partySize, restaurantName: string|null, offerId: string|null }`.
  - HTTP 404 with `errorType === "OFFER_NOT_FOUND"` → `none`.
  - 200 with zero slots → `none`.
  - 200 with slots → `available`. Use the field paths from `docs/api-notes.md`.
  - Anything else (401/403, HTML body, invalid JSON, other errors) → `error`, with a short reason.
- [ ] **3.2 Add `filterByTimeWindow(slots, timeWindow)`** to `src/parse.js`. `null` keeps
  everything. The buckets are `morning` (06:00–11:59), `afternoon` (12:00–15:59) and `evening`
  (16:00–23:59). `{start, end}` is inclusive.
- [ ] **3.3 Create `test/parse.test.js`** with tests that use every fixture in `test/fixtures/`, plus
  inline cases for a 403, an HTML body and invalid JSON. Test every `timeWindow` form.
- [ ] **3.4 Create `src/check.js`.** It exports `runCheck({ config, page })`, which:
  - loops over targets × dates × partySizes, waiting 5 s between calls
  - calls `getAvailability`, then `parseAvailability`, then `filterByTimeWindow`
  - saves each raw result to `local/raw/check-<target slug>-<date>-p<size>.json`, overwriting the previous one
  - returns `{ results: [{ target, date, partySize, status, slots, error }], hadErrors }`

  Use only the one-day endpoint here. (The indicator or range endpoints can replace it later, if
  `docs/api-notes.md` shows they work and the user has more dates.)
- [ ] **3.5 Create `scripts/run-check.js`** (npm script `check`). It:
  - loads the config, calls `openSession` with the env settings, then `runCheck`, then closes the browser
  - prints one line per result, for example `NONE  Candlelight 2026-12-11 party 4` or `OPEN  Candlelight 2026-12-11 party 2  17:30 (Rose & Crown), 18:00 (…)`
  - exits with code 0 if there were no errors, otherwise 1
- [ ] **3.6 Verify:**
  - `npm test` passes.
  - `npm run check` prints a line for party 4 and party 2 on 2026-12-11, and exits with 0.

**Done when:** the Verify checks pass. Add a Progress log entry.

---

## Phase 4: Discord alerts and state

**Requires:** Phase 3 done. **Touches Disney:** yes in 4.7 only.

- [ ] **4.1 🛑 USER STOP (webhook):** ask the user to create a Discord webhook. In Discord: Server
  Settings → Integrations → Webhooks → New Webhook → choose a channel → Copy Webhook URL. They paste
  it into `.env` as `DISCORD_WEBHOOK_URL` **themselves**. Optionally they also set
  `DISCORD_MENTION_USER_ID` (Discord: User Settings → Advanced → Developer Mode, then right-click
  your name → Copy User ID). Don't ask them to paste the URL into chat.
- [ ] **4.2 Create `src/notify.js`.** It exports `sendDiscord({ content, embeds })`, which POSTs JSON to
  the webhook with global `fetch`.
  - On HTTP 429, read `retry_after` (seconds) from the JSON body, wait that long, and retry once.
  - On any other failure, log the error and return `false`. Never throw, so alerting can't crash a check.
  - Also export `formatAvailabilityAlert(result)`, which builds the alert as one embed:
    - title `🍽️ OPEN: <target name>`
    - fields: date, party size, then each slot as `HH:MM — restaurant`
    - URL: the target's booking page (`https://disneyworld.disney.go.com/dine-res/<entityType>/<slug>/`)
    - footer: the check timestamp
    - `content`: `<@DISCORD_MENTION_USER_ID>` if set, plus `Book now!`
- [ ] **4.3 Create `src/state.js`.** It keeps `local/state.json` in this shape:
  `{ alerted: { [key]: firstSeenISO }, consecutiveErrorRuns: 0, errorAlertSent: false, lastHeartbeatDate: null }`,
  where `key = slug|date|partySize|time|restaurantName`.
  - It exports `loadState()` and `saveState(state)`. Save by writing a temp file and renaming it.
  - It exports `diffSlots(state, results)`, which returns `{ newSlots, goneKeys }`.
- [ ] **4.4 Wire alerts into `scripts/run-check.js`**, after `runCheck`:
  - Send one availability alert per target/date/party size that has new slots. Then add those keys to `alerted`.
  - Remove `goneKeys` from `alerted`, so a slot that disappears and comes back alerts again.
  - **Health:** if the run had errors, increase `consecutiveErrorRuns`. When it reaches **3** and
    `errorAlertSent` is false, send `⚠️ Disney checker failing: <first error reason>` and set
    `errorAlertSent`. After a run with no errors, if `errorAlertSent` was true, send
    `✅ Disney checker recovered`, then reset both.
  - **Heartbeat:** on the first successful run each day at or after 09:00 local time, send
    `💓 Checker alive — last result: <one-line summary>`, then set `lastHeartbeatDate`.
- [ ] **4.5 Create `scripts/test-alert.js`** (npm script `test-alert`). It sends a fake availability
  alert built from a success fixture, with the title prefixed `[TEST]`.
- [ ] **4.6 Create `test/state.test.js`.** It covers new-slot detection, gone-slot removal, the
  error counter reaching 3, and recovery. Use a temp folder for the state file.
- [ ] **4.7 Verify:**
  - `npm test` passes.
  - `npm run test-alert` posts to Discord. Ask the user to confirm they saw it.
  - `npm run check` runs twice in a row without sending a duplicate availability alert.

**Done when:** the Verify checks pass. Add a Progress log entry.

---

## Phase 5: Running in the background

**Requires:** Phase 4 done.

### 5A: Mac watch mode

- [ ] **5.1 Create `scripts/watch.js`** (npm script `watch`). It opens **one** browser session and keeps it.
  - In a loop: reload the page (handling Queue-it the same way), run the same steps as
    `run-check.js`, then sleep. Move the shared steps into a function `runOnce({ page, config })`
    in `src/check.js`, so both scripts use the same code.
  - Sleep for `CHECK_INTERVAL_MIN` minutes, plus or minus a random 0–2 minutes.
  - When a run has errors, double the sleep, up to 60 minutes. Reset it after a success.
  - If 3 runs in a row have errors, close and reopen the browser session.
  - On `SIGINT`/`SIGTERM`, close the browser and exit cleanly.
- [ ] **5.2 Add logging to a file.** Append each run's summary to `local/logs/watch.log` as well as
  the console. Each time the script starts, if the file is over 5 MB, rename it to `watch.log.1`
  (keep only one old file).
- [ ] **5.3 Update `README.md`** with: `caffeinate -i npm run watch`. `caffeinate` keeps the Mac awake
  while the watcher runs.
- [ ] **5.4 Verify:** run `CHECK_INTERVAL_MIN=1 npm run watch` for about 3 cycles, then press Ctrl+C.
  Logs show 3 runs, there are no duplicate alerts, and it exits cleanly.

### 5B: Oracle Cloud VM with cron (only after 5A works)

- [ ] **5.5 Create `scripts/export-session.js`** (npm script `export-session`). It opens the persistent
  profile headless, loads the booking page, saves `context.storageState()` to
  `local/storage-state.json`, and prints a reminder that **this file is a login secret**.
- [ ] **5.6 🛑 USER STOP (VM access):** ask the user for:
  - the SSH host alias for the VM (from their `~/.ssh/config`)
  - whether the VM is ARM (Ampere) or x86
  - confirmation that `node-projects` can be cloned on it (`git clone` of their GitHub repo)

  Don't guess hostnames.
- [ ] **5.7 Set up the VM over SSH:**
  - install Node 24: `curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - && sudo apt-get install -y nodejs`
    (if the VM isn't Debian/Ubuntu, stop and ask)
  - clone the repo
  - in `disney-dining/`: `npm ci`, then `npx playwright install --with-deps chromium`
  - create `.env` with `HEADLESS=true`, `STORAGE_STATE=local/storage-state.json` and the webhook
    variables. **The user pastes the webhook URL themselves.**
- [ ] **5.8 Copy the session:** run `npm run export-session` on the Mac, then
  `scp local/storage-state.json <host>:~/node-projects/disney-dining/local/`.
- [ ] **5.9 The decisive test:** on the VM, run `npm run check` **once**.
  - **If** you get JSON results: continue.
  - **If** you get HTML, a 403 or a Queue-it timeout: Disney is blocking the data-center IP.
    **Stop**, record that in the Progress log, and tell the user the VM won't work. Keep the Mac setup.
- [ ] **5.10 Install the cron job** with `crontab -e`, using absolute paths (find them with `which node`):
  ```
  SHELL=/bin/bash
  */10 * * * * cd $HOME/node-projects/disney-dining && sleep $((RANDOM % 120)) && flock -n /tmp/disney-dining.lock /usr/bin/node --env-file-if-exists=.env scripts/run-check.js >> local/logs/cron.log 2>&1
  ```
- [ ] **5.11 Verify:** after 30 minutes, `local/logs/cron.log` on the VM shows 3 runs with no errors.
  Tell the user that when the session expires, a "checker failing" alert arrives, and they repeat 5.8.
- [ ] **5.12 Note for the user:** Oracle may reclaim Always Free VMs it considers idle. Ask them to
  check the instance's status in the Oracle console after a week.

**Done when:** 5A is verified, and 5B is either verified or recorded as blocked. Add a Progress log entry.

---

## Phase 6: Hold the slot (freeze), then the user pays

**Requires:** Phase 4 done (Phase 5 optional). **Touches Disney booking endpoints:** yes. This is
the only phase allowed to.

**Important caveat to confirm first:** a freeze (hold) is probably tied to the **browser session
that made it**, not to the user's account. If so, the user can only finish checkout **in the
script's own browser**. That works on the Mac with `HEADLESS=false`, but not from the Oracle VM.
Task 6.3 checks this.

- [ ] **6.1 🛑 USER STOP (record a hold):** ask the user to run `npm run record`. In the browser, they:
  1. confirm the browser is logged in to the **dedicated checker account**
  2. search a restaurant with open times
  3. click a time, which creates the hold
  4. go as far as the payment page **without entering card details**
  5. go back or cancel, which should release the hold

  Then they press Enter.
- [ ] **6.2 Document the booking flow** in `docs/api-notes.md`:
  - the freeze, validate and thaw requests and responses
  - where `offerId` comes from in the availability response
  - the hold duration
  - the checkout page URL
- [ ] **6.3 Ask the user** to open `https://disneyworld.disney.go.com/dine-res/reservation` on their
  phone while a hold made in the script's browser is active (during 6.1). Do they see the held
  reservation? Record the answer.
- [ ] **6.4 Implement `src/hold.js`.** It exports `holdSlot(page, slot)`, which calls freeze (and validate,
  if 6.2 shows the site does). It returns `{ ok, expiresAt, checkoutUrl }`. It **never** submits
  payment or calls a confirm or book endpoint.
- [ ] **6.5 Wire it in** behind `AUTO_HOLD=true`. Add `AUTO_HOLD=false` to `.env.example` as well.
  When a new slot appears:
  - hold the best slot: party size 4 before 2, then the earliest time
  - send a Discord alert: `🔒 HELD until HH:MM — finish checkout now`, plus where to finish (the
    script's browser on the Mac, or the phone if 6.3 said yes)
  - in watch mode with a visible browser, navigate the page to `checkoutUrl` and leave it there
  - skip any further checks until the hold expires
  - if the hold fails, fall back to the plain availability alert
- [ ] **6.6 Verify** against a restaurant with plenty of open times, never Candlelight. Add a temporary
  test target and hold one slot. The user confirms they see the Discord alert and the checkout
  page. Then the user cancels the hold by hand. Remove the test target afterwards.

**Done when:** the Verify check passes and the Progress log records the 6.3 answer.

---

## Risks

- **Terms of service:** Disney's terms prohibit automated access. Keep the request rate modest, use
  one account, and prefer a residential IP.
- **Undocumented API:** it can change at any time. The script must fail loudly (health alerts), not silently.
- **Account lockout:** if Disney locks the account the script uses, the main account's trip,
  tickets and reservations aren't affected (Decision 6). Account action is more likely from
  repeated holds or booking and cancelling than from searching.
- **IP blocks:** Akamai mostly blocks by IP address and browser fingerprint, usually temporarily.
  The dedicated account doesn't protect against this. A flagged home IP can slow the main account
  on the same network too, so the request budget matters more than the account split.
- **Speed:** popular slots disappear in seconds. Alert speed matters more than polling frequency.
- **Secrets:** HAR files, `local/profile/` and `local/storage-state.json` contain live login
  sessions. Never commit or share them.

---

## Progress log

Each session adds an entry at the end of the phase: date, phase, what was done, verification
results, and surprises or open issues for the next session.

- **2026-10-24 (Phase 0):** Reviewed two HARs and the site's JS and config. Wrote the API reference
  and decisions. Rewrote this plan as a runbook. Added Decision 6 (dedicated checker account).
  No code yet.

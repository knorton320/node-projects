# Disney Dining Availability Checker: Plan and Runbook

Goal: check whether a Walt Disney World dining reservation is open for a given date and party
size, run the check in the background, and alert on Discord when something opens. An optional
later phase can hold (freeze) the slot so the user can finish checkout fast.

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
- **Never hold a slot outside Phase 6.** That means never clicking a time button on a Disney
  page, and never calling `api/freeze`, `api/validate` or `api/thaw`.
- **Never complete a booking, in any phase.** The script never calls anything under `/uc/`,
  `/checkout-booking/` or `paymentsheet.wdprapps.disney.com`, and never clicks anything on
  `/dine-res/reservation`. Checkout is always done by the user.
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

The booking window is a rolling 60 days (on 2026-10-29 it ran to 2026-12-28), so Dec 11 is
bookable now. On 2026-10-29 Candlelight still had nothing for party 2 on Dec 11.

### Control restaurant (canary)

A restaurant that reliably has open times. It proves the whole pipeline works, so a broken
parser can't silently report "nothing open" forever.

| Field | Value |
|---|---|
| Name | Chefs de France (EPCOT) |
| `facilityId` | `90001373` |
| `entityType` | `restaurant` |
| Known-good search | party 2 on 2026-12-11 had 15 open times on 2026-10-29 |

---

## Decisions

1. **Targets:** the config supports dining events and regular restaurants (`entityType`). The only
   target for now is Candlelight.
2. **Dates and times:** each target has a list of dates and an optional time window. Only matching
   slots alert.
3. **Language:** plain JavaScript, ESM.
4. **Hosting:** Mac first, then the Oracle Cloud VM running one check per cron run, if Disney
   doesn't block it.
5. **Booking:** the user always finishes checkout. Whether the script holds the slot first is
   Decision 7.
6. **Dedicated checker account:** the script only ever logs in with a separate Disney account
   (its own Gmail, **accurate** personal details, no made-up birthday). The user's main account,
   which holds tickets and the trip, is never logged into the script's browser. Default flow:
   the script checks on the dedicated account, and when an alert fires, the user books by hand
   on their main account. Automated holds (Phase 6) are tested on the dedicated account first.
7. **Hold mode (⚠️ PENDING: the user answers at the start of Phase 6).** The 2026-10-29 booking
   capture showed:
   - A hold lives in the browser that made it, under whichever account is logged in there.
   - It expires after **10 minutes**.
   - While it's held, nobody else can book that slot, **including the user on their phone**.
   - Finishing checkout in the script's browser books the reservation on the **checker
     account**, with the user's card. That only works at the Mac with a visible browser.

   The options:
   - **a) Alert only.** The user books on their main account from their phone. Works from the Mac
     and the VM. This is what Phases 1–5 build, and it's the default.
   - **b) Opt-in hold on the Mac** (`AUTO_HOLD=true`, visible browser only). For when the user is
     near the Mac. The reservation lands on the checker account.
   - **c) Hold while logged in to the main account.** This breaks Decision 6. Not recommended.

---

## API reference (from three HAR captures and the site's JS)

All endpoints are same-origin on `https://disneyworld.disney.go.com`. All are called **from inside
the Playwright page** (see "How requests are made").

| Purpose | Request | Status |
|---|---|---|
| **Facility availability, one day** (the core check) | `GET /dine-res/api/availability/{partySize}/{YYYY-MM-DD}?facilityId={facilityId};entityType={entityType}&entityType={entityType}` | `X-Function-Name: getAvailability`. The Candlelight page uses this call. "None" (404) is verified. The success shape for this exact call is confirmed in Phase 2 using the control restaurant. |
| General search, all facilities, one day | `GET /dine-res/api/availability/{partySize}/{date},{date}/00:00:00,23:59:59?trim=facets,media,webLinks,mediaGalleries,sortProductName&trimExclude=dining-events,diningEvent` | `X-Function-Name: getAvailability`. **Verified 200 with full success shape** (example below). About 545 KB. Lists only facilities that have times; a dining event shows up under `diningEvent["<id>"]` only when it has times. Use for the Phase 2 spike and as a fallback. |
| Entity details | `GET /dine-res/api/dine-detail/{slug}?entityType={entityType}` | `X-Function-Name: getFacilityDetails`. Returns `id` = `17736025;entityType=dining-event`. |
| Logged-in check | `GET /api/navigation/profile?isUser=true&brand=wdw&locale=en-us&userType=GUEST` | Not a dine-res call, so send it without the dine headers. Returned `{ "user": { … } }` when logged in. Logged-out shape unknown. |
| Season calendar | `GET /dine-res/api/calendar-days…` | **Not inventory.** Don't use it to decide availability. |
| Hold (Phase 6 only, done by the site after a UI click) | `POST /dine-res/api/freeze/{offerId}` with body `{}` | `X-Function-Name: freezeOfferDateRange`. Response: `{ "offerId", "expiryTime": "2026-10-30T00:18:29Z", "productAttributes": [...], "statusCode": 200 }`. `expiryTime` is UTC, 10 minutes after the hold. |
| Hold expiry | `GET /dine-res/api/offers/offerExpiry?expiryTime={iso}` | `X-Function-Name: getOfferDetails`. Informational. |
| **Don't call** | `POST /dine-res/api/v1/availability-indicator`, `GET /dine-res/api/availability/{party}/{start},{end}?facilityId=…` | In the site's JS, but the site never used them in any capture. Unusual calls are a bot-detection risk. |

**The facility query string is unusual. Copy it exactly.** `facilityId` contains a literal `;` and
`=`, and `entityType` appears twice. Build the URL as a plain template string. **Don't use
`URLSearchParams`**, because it would encode `;` and `=` differently from the site. For the control
restaurant, the URL is
`/dine-res/api/availability/2/2026-12-11?facilityId=90001373;entityType=restaurant&entityType=restaurant`.
That restaurant form is inferred from the site's JS, and Phase 2 confirms it.

**"No availability" response (facility call):** HTTP **404** with this body.

```json
{"conversationId":"…","correlationId":"…","errorType":"OFFER_NOT_FOUND","errorCode":"9010",
 "errorMessage":"WARN: GET_OFFERS DINING-EVENT: Offers not found for dine events 17736025.",
 "statusCode":404,"error":"Request failed with status code 404"}
```

**Success response:** abbreviated from the real 2026-10-29 general search (party 2, Dec 11).
Real responses have many more facilities, meal periods, offers and extra fields.

```json
{
  "restaurant": {
    "90001373": {
      "id": "90001373;entityType=restaurant",
      "name": "Chefs de France",
      "offers": {
        "2026-12-11": [
          {
            "enterpriseMealPeriodId": "41992", "mealPeriodType": "Lunch",
            "mealPeriodName": "Chefs de France Lunch", "startTime": "12:00:00", "endTime": "15:00:00",
            "offersByAccessibility": [
              { "accessibilityLevel": "GENERAL", "offers": [
                { "offerId": "c304a62a-cfb2-c7df-ca05-cf376cf979e1:1", "time": "12:20:00", "label": "12:20 PM" },
                { "offerId": "c304a62a-cfb2-c7df-ca05-cf376cf979e1:2", "time": "12:30:00", "label": "12:30 PM" }
              ] }
            ]
          },
          {
            "enterpriseMealPeriodId": "41994", "mealPeriodType": "Dinner",
            "mealPeriodName": "Chefs de France Dinner", "startTime": "16:00:00", "endTime": "20:55:00",
            "offersByAccessibility": [
              { "accessibilityLevel": "GENERAL", "offers": [
                { "offerId": "c304a62a-cfb2-c7df-ca05-cf376cf979e1:9", "time": "18:30:00", "label": "06:30 PM" },
                { "offerId": "c304a62a-cfb2-c7df-ca05-cf376cf979e1:10", "time": "19:30:00", "label": "07:30 PM" }
              ] }
            ]
          }
        ]
      }
    }
  },
  "diningEvent": {
    "17736028": {
      "id": "17736028;entityType=dining-event",
      "name": "Fantasmic Dining Packages",
      "eventTimes": [
        {
          "eventProductId": "16276285",
          "eventLabel": "Fantasmic! Viewing 2nd Show",
          "eventFacilityId": "80008014",
          "restaurant": {
            "90002245": {
              "id": "90002245;entityType=restaurant",
              "name": "The Hollywood Brown Derby",
              "offers": {
                "2026-12-11": [
                  {
                    "enterpriseMealPeriodId": "19030807", "mealPeriodType": "Lunch",
                    "mealPeriodName": "The Hollywood Brown Derby Lunch Fantasmic! 2nd Show",
                    "startTime": "11:00:00", "endTime": "15:55:00",
                    "offersByAccessibility": [
                      { "accessibilityLevel": "GENERAL", "offers": [
                        { "offerId": "5359abb4-ebfc-5905-d7c0-73c3361dfc26:11", "time": "11:00:00", "label": "11:00 AM" },
                        { "offerId": "5359abb4-ebfc-5905-d7c0-73c3361dfc26:15", "time": "11:15:00", "label": "11:15 AM" }
                      ] }
                    ]
                  }
                ]
              }
            }
          }
        }
      ]
    }
  },
  "dinnerShow": {},
  "statusCode": 200
}
```

How to read the success response:
- **Restaurants:** `restaurant[<id>].offers[<date>][]` is a list of meal periods. Each meal period
  has `offersByAccessibility[].offers[]`, and each offer is `{ offerId, time, label }`.
- **Dining events (Candlelight):** `diningEvent[<id>].eventTimes[]`. Each entry may have an
  `eventLabel` (which show) and contains `restaurant[<id>]` objects with the same `offers` shape.
  "Any restaurant in the package" means any restaurant under any `eventTimes` entry.
- **Dinner shows** (not needed now) use `offers[<date>][].offerTimes[].offers[]` instead.
- **Times** are park-local strings like `"18:30:00"`, so no time-zone conversion is needed.
  `label` is the display form, `"06:30 PM"`.
- **The facility call may wrap results under different top-level keys** (the site's JS reads
  `restaurants`, `diningEvents` or `dinnerShows`). The parser below doesn't depend on those keys.
- **`offerId` is a throwaway search token,** shaped `<search-uuid>:<n>`. One UUID is shared by a
  whole response, and it changes on every search. Never store it, dedupe on it, or reuse it later.

**Booking flow** (2026-10-29 capture; documentation only, the script never does this):
1. The user clicks a time. The site calls `freeze`, which holds the slot for 10 minutes, then moves
   to `/dine-res/reservation`. The page state lives in `sessionStorage` (`dineStoreState`), and the
   reservation page only opens if that state has a selected offer.
2. The reservation page loads add-ons and dietary options. The user clicks continue.
3. `POST /uc/initialize` builds the checkout. Its state lives in a cookie (`ucConfiguration`) and
   `localStorage`, then the browser goes to `/checkout-booking/`.
4. `POST /uc/api/v1/order/create/` creates the order.
5. The user enters their card in an iframe on `paymentsheet.wdprapps.disney.com`.
6. `POST /uc/api/v1/order/checkout/` returns `orderStatus: "COMPLETED"` and a confirmation number.
   It charged $0 (a credit card guarantee).

From hold to confirmation took the user **about 40 seconds**. Because every step keeps its state
in the browser, **a hold can only be finished in the browser that made it**. And calling `freeze`
directly, without the site's own state, would block the slot with no way to finish. So Phase 6
holds by clicking in the page, never by calling the API.

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
- **Akamai Bot Manager** runs on the site, and the site's config has `enableBotMitigation: true`.
  Plain Node `fetch` with copied cookies will very likely be blocked.
- A **Queue-it waiting room** sits in front of `/dine-res/` at times. It appeared in 1 of 3
  captures: the page load redirected to `disneyparks.queue-it.net` and came back with
  `?queueittoken=…`.
- **OneTrust cookie banner.** Selectors, from `../../mouse-mcp/src/clients/session-manager.ts`:
  `#onetrust-accept-btn-handler`, `[data-testid="cookie-accept"]`, `button[aria-label*="Accept"]`.

**Site config** (`GET /dine-res/api/app-config/`): time zone `America/New_York`, `maxPartySize=20`,
`maxCalendarDays=60`, time buckets `morning 6-12 | afternoon 12-16 | evening 16-24`.

---

## How requests are made (key design)

1. Launch Chromium with Playwright using a **persistent profile** at `local/profile/`. The user logs
   in there once, by hand, with the **checker account**, and the profile keeps the login between runs.
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

The object `apiRequest` returns, `{ status, url, contentType, text }`, is called a **raw result**.
Raw results are what get saved to `local/raw/` and to `test/fixtures/`.

## Parsing slots (reference code for `src/parse.js`)

This was tested against the real 2026-10-29 response. It found 2,003 slots across restaurants,
dining events and dinner shows, every one with a time and a restaurant name, and none for the wrong
date. Copy it exactly.

```js
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
```

**Classifying a facility-call raw result** (the rules `classifyResult` in Phase 3 implements):

| Raw result | Status | Meaning |
|---|---|---|
| 404, and JSON `errorType === "OFFER_NOT_FOUND"` | `none` | Nothing open. |
| 200 JSON, and `extractSlots` finds 1 or more slots | `available` | Open times found. |
| 200 JSON, and `extractSlots` finds 0 slots | `unparsed` | **Disney says something is open, but the times couldn't be read. Alert anyway.** A false alarm is cheap; a missed slot isn't. |
| `contentType` contains `text/html` | `error` | Blocked, or stuck in Queue-it. |
| 401 or 403 | `error` | Login expired, or blocked. |
| Anything else, or invalid JSON | `error` | Use reason `HTTP <status>`. |

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
    parse.js            extractSlots, classifyResult, time windows      (Phase 3)
    check.js            one full run over all targets                   (Phase 3)
    state.js            dedupe + health counters in local/state.json    (Phase 4)
    notify.js           Discord webhook                                 (Phase 4)
    hold.js             UI-driven hold (only if Decision 7 = b)         (Phase 6)
  scripts/
    validate-config.js  (Phase 1)
    login.js            opens a visible browser for manual login        (Phase 2)
    spike.js            calls each endpoint once, saves raw output      (Phase 2)
    run-check.js        CLI for `npm run check`                         (Phase 3)
    test-alert.js       sends one test Discord message                  (Phase 4)
    watch.js            long-running loop                               (Phase 5)
    export-session.js   writes local/storage-state.json for the VM      (Phase 5)
    ui-snapshot.js      saves page structure for picking selectors      (Phase 6)
  test/
    fixtures/           raw results (examples from this plan + real ones from Phase 2)
    *.test.js           node:test tests (no network)
  docs/api-notes.md     what Phase 2 confirmed or corrected
  local/                gitignored: profile/, raw/, logs/, state.json, storage-state.json
```

---

## Phase 0: Discovery ✅

- [x] Capture HARs of the search flow (two captures, no openings found).
- [x] Capture a successful search and booking (2026-10-29, Chefs de France).
- [x] Decide the target, dates, party sizes and time window (see Target).
- [x] Answer the open questions (see Decisions; Decision 7 waits for Phase 6).

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
  # Browser profile folder that holds the Disney login (checker account)
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
    ],
    "canary": {
      "name": "Chefs de France (canary)",
      "facilityId": "90001373",
      "entityType": "restaurant",
      "partySize": 2,
      "daysAhead": 30
    }
  }
  ```
  `timeWindow` is `null`, one of `"morning" | "afternoon" | "evening"`, or
  `{ "start": "17:00", "end": "20:00" }` (24-hour clock, park local time). The canary searches
  `daysAhead` days from today, so its date never goes stale.
- [ ] **1.5 Create `src/log.js`.** It exports `log.debug/info/warn/error(msg, data?)`, which print
  `ISO-timestamp LEVEL msg {json}` and respect `LOG_LEVEL`.
- [ ] **1.6 Create `src/config.js`.** It exports `loadConfig(path = 'config/targets.json')`, which reads
  and parses the file and validates it. Collect all problems, then throw one error that lists them.
  For each target:
  - `name`, `slug`, `facilityId` are non-empty strings
  - `entityType` is `"dining-event"` or `"restaurant"`
  - `dates` is a non-empty array of `YYYY-MM-DD` strings that are real calendar dates
  - `partySizes` is a non-empty array of integers 1–20
  - `timeWindow` is valid as described in 1.4
  - `enabled` is a boolean

  `canary` is optional. If present: `name` and `facilityId` are non-empty strings, `entityType` is
  valid, `partySize` is an integer 1–20, and `daysAhead` is an integer 1–59.

  It returns `{ targets, canary }`, with only the enabled targets, and `canary` set to `null` if
  it's missing.
- [ ] **1.7 Create `scripts/validate-config.js`.** It calls `loadConfig()` and prints one line per
  target, like `OK  EPCOT Candlelight… | 2026-12-11 | party 4,2 | any time`, plus
  `OK  canary Chefs de France (canary) | party 2 | 30 days ahead` if there is one. On error it
  prints the message and exits with code 1.
- [ ] **1.8 Create `test/config.test.js`** with `node:test` and `node:assert/strict`:
  - the real `config/targets.json` loads
  - a bad date (`2026-02-30`), party size `0`, an unknown `entityType`, a bad `timeWindow` and a
    canary `daysAhead` of `90` each throw

  Write the bad configs to a temp folder with `fs.mkdtempSync(path.join(os.tmpdir(), 'dd-'))`.
- [ ] **1.9 Create `README.md`**, 15 lines at most: what the project is, `npm install`, `npx playwright install chromium`,
  `cp .env.example .env`, `npm run validate-config`, `npm test`, and "see PLAN.md for phases".
- [ ] **1.10 Verify:**
  - `npm run validate-config` prints one `OK` line for Candlelight and one for the canary.
  - `npm test` passes all tests.
  - From the repo root, `git status --porcelain disney-dining` shows no `.env`, `local/` or `node_modules/`.

**Done when:** all three Verify checks pass. Add a Progress log entry, then stop.

---

## Phase 2: Browser session and API spike

**Requires:** Phase 1 done. **Touches Disney:** yes. Follow the request budget.
**Purpose:** prove that requests from inside the page work, and capture a real **facility-call**
success response (from the control restaurant), so Phase 3 is built against real data.

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
- [ ] **2.2 Create `src/disney-api.js`.** Include `apiRequest` exactly as in "How requests are made",
  plus these helpers. Each returns the raw result from `apiRequest`.
  - `getFacilityAvailability(page, { facilityId, entityType, partySize, date })`, using the
    facility one-day URL. Build it with a template string, not `URLSearchParams`.
  - `getGeneralAvailability(page, { partySize, date })`, using the general search URL.
  - `getDineDetail(page, { slug, entityType })`.
  - `isLoggedIn(page)`. It runs a plain in-page `fetch` of the logged-in check URL, with
    `credentials: 'include'` and only an `accept: application/json` header. It returns `true` if
    the JSON has a `user` object.
- [ ] **2.3 Create `scripts/login.js`** (npm script `login`). It opens the target's booking page with
  `headless: false` and the persistent profile. It prints: *"Log in to My Disney Experience in the
  browser window with the CHECKER account (not your main account). Press Enter here when the page
  shows you as signed in."* It waits for Enter (use `node:readline`), prints the result of
  `isLoggedIn`, then closes.
- [ ] **2.4 🛑 USER STOP (login):** ask the user to run `npm run login` and sign in by hand with
  the **dedicated checker account, not their main Disney account** (see Decision 6). Wait for
  them to confirm it printed `true`. If they don't have the dedicated account yet, wait while
  they create it.
- [ ] **2.5 Create `scripts/spike.js`** (npm script `spike`). It opens the Candlelight booking page,
  then makes **these calls only**, 5 s apart. It saves each raw result to
  `local/raw/spike-<n>-<name>.json`.
  1. `candlelight-p4`: `getFacilityAvailability` for Candlelight, party 4, `2026-12-11`. Expect 404 `OFFER_NOT_FOUND`.
  2. `candlelight-p2`: the same for party 2.
  3. `control`: `getFacilityAvailability` for Chefs de France (`90001373`, `restaurant`), party 2,
     `2026-12-11`. Expect 200 with times.
  4. Only if call 3 returned 4xx: `control-bare`, a retry with
     `?facilityId=90001373&entityType=restaurant`. This is the one exception to "copy the URL
     exactly". Note which form worked.
  5. `general-p2`: `getGeneralAvailability`, party 2, `2026-12-11`. Expect 200.
  6. `logged-in`: `isLoggedIn`.

  For each call it prints one line: name, HTTP status, body size, and the first 150 characters of
  the body. For `general-p2` it also prints whether `json.diningEvent?.['17736025']` exists, which
  means Candlelight has times for party 2.
- [ ] **2.6 Run `npm run spike`** with `HEADLESS=false`, then again with `HEADLESS=true`.
  - Note whether headless gets blocked: HTML instead of JSON, a 403, or a Queue-it loop.
- [ ] **2.7 Logged-out test:** run `PROFILE_DIR=local/profile-anon npm run spike` once. Note whether
  availability calls work without a login.
- [ ] **2.8 Write `docs/api-notes.md`.** Base it on the files in `local/raw/`. Record:
  - the **top-level keys** of the `control` success response (for example `restaurants`), and an
    abbreviated example of it
  - whether the facility URL form for restaurants matched the plan (call 3 vs. call 4)
  - the status of every spike call, headed and headless
  - whether login is required
  - whether headless works
  - whether Queue-it appeared
  - anything that contradicts the API reference in this plan
- [ ] **2.9 Save fixtures to `test/fixtures/`** (each file is a raw result object):
  - `facility-none-dining-event.json`, from `candlelight-p4` (or `-p2`), if it was a 404
  - `facility-success-restaurant.json`, from `control` (or `control-bare`)
  - `general-search-success.json`, from `general-p2`, trimmed to keep the file small. Parse
    `text`, keep only the first 3 keys of `restaurant` and the first 2 of `diningEvent`, then
    stringify it back into `text`.

  These responses shouldn't contain personal data, but check anyway: search each file for `@`,
  `swid`, `{`-wrapped GUIDs, `firstName`, `lastName`, `email` and `phone`, and replace any
  personal values with `"REDACTED"`.
- [ ] **2.10 Verify:**
  - `local/raw/spike-3-control.json` (or `spike-4-control-bare.json`) has status 200.
  - `grep -c offersByAccessibility test/fixtures/facility-success-restaurant.json` prints 1 or more.
  - `npm test` still passes.

**Done when:** the Verify checks pass. If the control call never returned 200 with
`offersByAccessibility`, or every in-page call was blocked, **stop and report**, because Phase 3
can't proceed. Add a Progress log entry that summarizes the answers from 2.8.

---

## Phase 3: One-shot check

**Requires:** Phase 2 done, and `test/fixtures/facility-success-restaurant.json` exists.
**Touches Disney:** yes in 3.7 only.

- [ ] **3.1 Create the plan-example fixtures** as raw result objects:
  - `test/fixtures/plan-example-success.json`:
    `{ "status": 200, "url": "plan-example", "contentType": "application/json", "text": "<the success example from the API reference, as a JSON string>" }`
  - `test/fixtures/plan-example-none.json`: the same, with status 404 and the "no availability"
    body. Replace the `…` placeholders with any strings.
- [ ] **3.2 Create `src/parse.js`.**
  - Copy `extractSlots` and `makeSlot` **exactly** from "Parsing slots".
  - Add `classifyResult(raw, { date, partySize })`, following the classification table. It returns
    `{ status: 'available' | 'none' | 'unparsed' | 'error', slots, error? }`, and adds
    `partySize` to every slot.
- [ ] **3.3 Add `filterByTimeWindow(slots, timeWindow)`** to `src/parse.js`. `null` keeps
  everything. The buckets are `morning` (06:00–11:59), `afternoon` (12:00–15:59) and `evening`
  (16:00–23:59). `{start, end}` is inclusive.
  - If an `available` result loses all its slots to the window, its status becomes `none`. Keep a
    `filteredOut` count for logs.
  - The window never applies to `unparsed`; those always alert.
- [ ] **3.4 Create `test/parse.test.js`**, covering:
  - `plan-example-success.json` with `extractSlots(json, '2026-12-11')`:
    - 4 slots for Chefs de France
    - 2 Fantasmic slots, with `eventLabel` `"Fantasmic! Viewing 2nd Show"` and `restaurantName`
      `"The Hollywood Brown Derby"`
    - 0 slots for `'2026-12-12'`
  - `plan-example-none.json` and `facility-none-dining-event.json` classify as `none`.
  - `facility-success-restaurant.json` classifies as `available`, with 1 or more slots.
  - `general-search-success.json`: `extractSlots` finds 1 or more slots.
  - Inline cases: 403 → `error`; an HTML body → `error`; invalid JSON → `error`; 200 with `{}` → `unparsed`.
  - Every `timeWindow` form, including the "all filtered out → `none`" case.
- [ ] **3.5 Create `src/check.js`.** It exports `runCheck({ config, page })`, which:
  - loops over targets × dates × partySizes, waiting 5 s between calls
  - calls `getFacilityAvailability`, then `classifyResult`, then `filterByTimeWindow`
  - saves each raw result to `local/raw/check-<target slug>-<date>-p<size>.json`, overwriting the previous one
  - returns `{ results: [{ target, date, partySize, status, slots, error }], hadErrors }`
- [ ] **3.6 Create `scripts/run-check.js`** (npm script `check`). It:
  - loads the config, calls `openSession` with the env settings, then `runCheck`, then closes the browser
  - prints one line per result:
    - `NONE   Candlelight 2026-12-11 party 4`
    - `OPEN   Candlelight 2026-12-11 party 2  17:30 Rose & Crown (Candlelight 5:00 show), …`
      (put `eventLabel` in brackets when present)
    - `CHECK  Candlelight 2026-12-11 party 2  Disney says open but times unreadable`
    - `ERROR  Candlelight 2026-12-11 party 4  <reason>`
  - exits with code 0 if there were no errors, otherwise 1
- [ ] **3.7 Verify:**
  - `npm test` passes.
  - `npm run check` prints a line for party 4 and party 2 on 2026-12-11, and exits with 0.

**Done when:** the Verify checks pass. Add a Progress log entry.

---

## Phase 4: Discord alerts, state and canary

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

  It also exports two formatters:
  - `formatAvailabilityAlert(result)`, which builds one embed:
    - title `🍽️ OPEN: <target name>`
    - fields: date, party size, then each slot as `HH:MM — <restaurantName>`, adding
      ` (<eventLabel>)` when present
    - URL: the target's booking page (`https://disneyworld.disney.go.com/dine-res/<entityType>/<slug>/`)
    - footer: the check timestamp
    - `content`: `<@DISCORD_MENTION_USER_ID>` if set, plus `Book now!`
  - `formatUnparsedAlert(result)`: title `⚠️ POSSIBLY OPEN: <target name>`, with the text
    "Disney returned availability but the times couldn't be read. Check the page now." Same URL
    and mention.
- [ ] **4.3 Create `src/state.js`.** It keeps `local/state.json` in this shape:
  ```json
  { "alerted": {}, "unparsedAlertedAt": {}, "consecutiveErrorRuns": 0, "errorAlertSent": false, "lastHeartbeatDate": null }
  ```
  - `alerted` maps each slot key to its first-seen ISO time. The key is
    `slug|date|partySize|time|restaurantName|eventLabel`, with an empty string for a null
    `eventLabel`. **Never put `offerId` in a key**; it changes on every search.
  - `unparsedAlertedAt` maps `slug|date|partySize` to the ISO time of the last unparsed alert.
  - It exports `loadState()` and `saveState(state)`. Save by writing a temp file and renaming it.
  - It exports `diffSlots(state, results)`, which returns `{ newSlots, goneKeys }`.
- [ ] **4.4 Wire alerts into `scripts/run-check.js`**, after `runCheck`:
  - **Availability:** send one alert per target/date/party size that has new slots. Then add those
    keys to `alerted`. Remove `goneKeys` from `alerted`, so a slot that disappears and comes back
    alerts again.
  - **Unparsed:** send `formatUnparsedAlert` if there's no entry in `unparsedAlertedAt`, or the
    last one was more than 30 minutes ago.
  - **Health:** if the run had errors, increase `consecutiveErrorRuns`. When it reaches **3** and
    `errorAlertSent` is false, send `⚠️ Disney checker failing: <first error reason>` and set
    `errorAlertSent`. After a run with no errors, if `errorAlertSent` was true, send
    `✅ Disney checker recovered`, then reset both.
  - **Heartbeat and canary:** on the first successful run each day at or after 09:00
    America/New_York, also check the canary:
    1. Wait 5 s.
    2. Call `getFacilityAvailability` for `config.canary`, with date = today in America/New_York
       plus `daysAhead` days. Get today with
       `new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())`,
       then add days using UTC date math.
    3. Classify it.
    4. If it's `available`, send `💓 Checker alive — canary OK (<n> times) — last result: <one-line summary>`.
    5. Otherwise send
       `⚠️ Canary failed (<status>): Chefs de France shows no times — the checker may be broken (API or page changed)`.
    6. Set `lastHeartbeatDate`.
- [ ] **4.5 Create `scripts/test-alert.js`** (npm script `test-alert`). It sends a fake availability
  alert built from `plan-example-success.json`, with the title prefixed `[TEST]`.
- [ ] **4.6 Create `test/state.test.js`.** Use a temp folder for the state file. It covers:
  - new-slot detection, and the same slot under a different `eventLabel` counting as new
  - gone-slot removal
  - unparsed re-alert after 30 minutes but not before
  - the error counter reaching 3, and recovery
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
    variables. **The user pastes the webhook URL themselves.** Never set `AUTO_HOLD` on the VM;
    a hold there can't be finished (see Decision 7).
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

## Phase 6 (optional): Hold the slot, then the user pays

**Requires:** Phase 4 done (Phase 5A recommended). **This is the only phase allowed to hold a slot.**

**What the 2026-10-29 capture settled:**
- The site holds a slot when the user **clicks a time button**. It calls `freeze`, then moves to
  `/dine-res/reservation`.
- The reservation page needs the site's own `sessionStorage` state. That's why the script must
  **click the time in the page** and must not call `api/freeze` itself: a direct API hold blocks
  the slot with no way to finish.
- The hold lasts **10 minutes**. While it's held, nobody else can book that slot, including the user
  on their phone. A hold the user can't finish costs them that slot for 10 minutes.
- Checkout can only be finished in the script's browser, logged in as the checker account. So the
  reservation lands on the checker account.

- [ ] **6.1 🛑 USER STOP (Decision 7):** explain the three options in Decision 7 to the user and ask
  which they want.
  - If **a) Alert only**: mark every remaining Phase 6 task `skipped (Decision 7 = a)`, add a
    Progress log entry, and stop.
  - If **c)**: confirm the user understands it breaks Decision 6. Then continue as for b), with the
    main account logged into a **separate** profile folder.
  - If **b)**: continue.
- [ ] **6.2 Create `scripts/ui-snapshot.js`** (npm script `ui-snapshot`). It opens a URL given as an
  argument, with a visible browser and the persistent profile. Then it:
  1. saves `await page.locator('body').ariaSnapshot()` to `local/raw/ui-<name>-1-loaded.txt`, plus a screenshot
  2. prints *"Pick the party size and date in the browser and show the times. Do NOT click a time.
     Press Enter here when the times are visible."*
  3. after Enter, saves a second snapshot and screenshot as `-2-times`

  It never clicks anything itself.
- [ ] **6.3 🛑 USER STOP (snapshots):** ask the user to run `npm run ui-snapshot` twice:
  - on the Candlelight booking page, to capture the party size and date controls. There will
    probably be no times.
  - on a restaurant page with open times, to capture the time buttons. Ask the user for that
    page's URL: in their browser, they open Chefs de France's "Check Availability" page.
- [ ] **6.4 Document the selectors** in `docs/api-notes.md`, based on the snapshots: how to pick the
  party size, how to pick a date, how to start the search (if there's a button), and what a time
  button looks like (role and accessible name, for example `button "06:30 PM"`). Prefer
  `page.getByRole(...)` locators.
- [ ] **6.5 Create `src/hold.js`.** It exports `holdViaUi(page, { bookingUrl, partySize, date, slot, dryRun })`, which:
  1. navigates to `bookingUrl` (handling Queue-it and the cookie banner the same way as `openSession`)
  2. picks the party size and date with the documented locators, then waits for times
  3. finds the time button whose label matches `slot.label`, under the right restaurant
  4. **If `dryRun`:** logs what it would click and returns `{ ok: true, dryRun: true }`. Nothing is held.
  5. Otherwise: starts
     `page.waitForResponse(r => r.url().includes('/dine-res/api/freeze/'))`, clicks the button,
     and waits up to 20 s for the URL to contain `/dine-res/reservation`
  6. returns `{ ok, expiresAt, restaurantName, time }`. `expiresAt` comes from the freeze
     response's `expiryTime` (UTC).

  It never clicks anything on the reservation page.
- [ ] **6.6 Wire it in** behind `AUTO_HOLD=true`. Add `AUTO_HOLD=false` and `HOLD_DRY_RUN=true` to
  `.env.example` as well.
  - If `AUTO_HOLD=true` and `HEADLESS=true`: log a warning and don't hold. A hold in a hidden
    browser can't be finished.
  - When a new slot appears for a target, hold the best slot: party size 4 before 2, then the
    earliest time.
  - Send a Discord alert:
    `🔒 HELD <restaurant> <HH:MM> party <n> until <expiry in America/New_York, h:mm a> — finish checkout in the browser on the Mac`.
    Include the normal availability details.
  - Pause checking until the hold expires plus 1 minute, then reload and resume.
  - If the hold fails, send the normal availability alert.
- [ ] **6.7 Verify, dry run first:**
  - With `HOLD_DRY_RUN=true`, run a hold against the control restaurant's open times. Logs show the
    correct button would be clicked.
  - Then, **only with the user watching**, run it once with `HOLD_DRY_RUN=false` on the control
    restaurant, never Candlelight. The user confirms the Discord alert and that the reservation
    page is showing.
  - The user doesn't book. They go back, or let the hold expire. Remove any temporary test config.

**Done when:** the Verify checks pass and the Progress log records the Decision 7 answer.

---

## Risks

- **Terms of service:** Disney's terms prohibit automated access. Keep the request rate modest, use
  one account, and prefer a residential IP.
- **Undocumented API:** it can change at any time. The script must fail loudly (health alerts), not
  silently. The daily canary catches the worst case: a parser that silently reports "none" forever.
- **Account lockout:** if Disney locks the account the script uses, the main account's trip,
  tickets and reservations aren't affected (Decision 6). Account action is more likely from
  repeated holds or booking and cancelling than from searching.
- **IP blocks:** Akamai mostly blocks by IP address and browser fingerprint, usually temporarily.
  The dedicated account doesn't protect against this. A flagged home IP can slow the main account
  on the same network too, so the request budget matters more than the account split.
- **Holds can backfire:** a hold blocks the slot for everyone, including the user's phone, for 10
  minutes. Only enable `AUTO_HOLD` when the user can reach the Mac.
- **Speed:** popular slots disappear in seconds. Alert speed matters more than polling frequency.
  Booking took the user about 40 seconds once a slot was held.
- **Secrets:** HAR files, `local/profile/` and `local/storage-state.json` contain live login
  sessions. Never commit or share them.

---

## Progress log

Each session adds an entry at the end of the phase: date, phase, what was done, verification
results, and surprises or open issues for the next session.

- **2026-10-24 (Phase 0):** Reviewed two HARs and the site's JS and config. Wrote the API reference
  and decisions. Rewrote this plan as a runbook. Added Decision 6 (dedicated checker account).
  No code yet.
- **2026-10-29 (Phase 0):** Reviewed a HAR of a successful search and booking (Chefs de France,
  party 2, Dec 11). Recorded the success response shape, a tested reference parser, the hold and
  checkout flow (10-minute hold, finished only in the same browser), and that `offerId` is a
  throwaway token. Candlelight still had nothing for party 2 on Dec 11. Changes:
  - **Phase 2:** removed the unused indicator and range endpoints, and added a control restaurant.
  - **Phase 3:** a 200 with unreadable times now alerts as `unparsed`.
  - **Phase 4:** added a daily canary, and `eventLabel` is now part of the dedupe key.
  - **Phase 6:** rewritten to hold by clicking in the page, with a dry run first.
  - **Decision 7** (hold mode) waits for the user at the start of Phase 6.

# API notes (Phase 2 findings)

What the Phase 2 spike confirmed or corrected, from real calls on 2026-10-29/30. Raw results are in
`local/raw/` (gitignored). Each call below was made from inside the Playwright page, 5 s apart.

## Summary

| Question | Answer |
|---|---|
| Do in-page calls work? | **Yes, headed, logged in, with an `Authorization` header** (see below). |
| Is login required? | **Yes.** Logged out, every availability call returns 401 `AUTHORIZATION_FAILURE` and the general search hits an Akamai challenge (428, `sec-cp-challenge`). |
| Does headless work? | **No.** `page.goto` fails with `net::ERR_HTTP2_PROTOCOL_ERROR` before any API call, twice in a row. Disney/Akamai drops the headless browser at the connection level. Not worked around. |
| Did Queue-it appear? | No, in any run. |
| Did the restaurant facility URL form match the plan? | **Yes.** `?facilityId=90001373;entityType=restaurant&entityType=restaurant` returned 200. The bare-form retry (`control-bare`) was not needed. |

## Spike call statuses

| Call | Headed, logged in | Headless | Headed, logged out (empty profile) |
|---|---|---|---|
| `candlelight-p4` | 404 `OFFER_NOT_FOUND` | not run (blocked at page load) | 401 `AUTHORIZATION_FAILURE` |
| `candlelight-p2` | 404 `OFFER_NOT_FOUND` | not run | 401 |
| `control` (Chefs de France, party 2) | **200**, 2 meal periods | not run | 401 |
| `control-bare` | not needed | not run | 401 (retry, because `control` was 4xx) |
| `general-p2` | **200**, ~542 KB | not run | 428 Akamai challenge |
| `logged-in` | `true` | not run | `false` |

Candlelight has no times for party 2 or 4 on 2026-12-11, and the general search agrees
(`diningEvent['17736025']` is absent).

## Corrections to the API reference in PLAN.md

### 1. Every `/dine-res/api/` call needs `Authorization: Bearer <JWT>`

The header list in PLAN.md was incomplete. Without this header every call is 401 `BAD_AUTHZ_TOKEN`.

- The site's Angular interceptor adds it (`raTokenService.extractGuestToken()` when logged in).
- The token is a 24-hour JWT (claims: `jti iss aud iat nbf exp client_id cat lid sub`).
- It is held **in memory by Disney's OneID SDK**. It is *not* in any cookie, `localStorage`,
  `sessionStorage`, IndexedDB, or response body/header, and no `OneID.get()` method returns it.
- The same token is sent to `registerdisney.go.com` and `/profile/guest-services`.
- **Our approach:** `trackAuthorization(page)` (in `src/disney-api.js`, called by `loadPage`) listens
  for the site's own `/dine-res/api/` requests, which fire on every page load, and keeps the latest
  `authorization` header in memory. `apiRequest` adds it to our calls. Never log it or write it to
  disk. Reloading the page refreshes it, which suits watch mode.
- Don't call `OneID` methods such as `forceTokenRefresh` or `launchReauth` to look for it. They send
  extra requests to Disney, and `launchReauth` can open UI.

### 2. The logged-in check needs `swid` and `token` headers

A bare `fetch` of `/api/navigation/profile?isUser=true&brand=wdw&locale=en-us&userType=GUEST` returns
401 `{ "message": … }` even when signed in. The site sends the values of the `SWID` and
`TPR-WDW-LBJS.WEB-PROD.token` cookies as `swid` and `token` headers, plus `conversation-id`. With them
it returns 200 and `{ user: {…} }`. `isLoggedIn` does this in the page. Logged out, it returns `false`
(no cookies to send).

### 3. The facility-call success shape differs from the general search

The facility one-day call returns:

```json
{
  "restaurants": {
    "2026-12-11": [
      {
        "enterpriseMealPeriodId": "41992", "mealPeriodType": "Lunch",
        "mealPeriodName": "Chefs de France Lunch", "startTime": "12:00:00", "endTime": "15:00:00",
        "cuisine": "French", "serviceStyle": "A la Carte", "experienceType": "Casual Dining",
        "isAddOnEnable": true, "isUpgradeAvailable": false,
        "offersByAccessibility": [
          { "accessibilityLevel": "GENERAL", "offers": [
            { "offerId": "<search-uuid>:1", "time": "12:20:00", "label": "12:20 PM" }
          ] }
        ]
      }
    ]
  },
  "statusCode": 200
}
```

- Top-level keys: `restaurants`, `statusCode`.
- `restaurants` is keyed **directly by date**. There is **no `offers` wrapper** and **no restaurant
  `id` or `name`** in the response (the facility is the one you asked for).
- The plan's `extractSlots` only looks for an object whose `offers` is a map keyed by date, so it
  would find **0 slots** here and every result would classify as `unparsed`. Phase 3 must handle this
  shape (see the Phase 3 note in PLAN.md). For a dining event the equivalent success shape is still
  unconfirmed, because Candlelight has had no times in any capture. The general search *does* show
  the `diningEvent` shape (fixture `general-search-success.json`).
- Meal periods may carry extra fields (`cuisine`, `serviceStyle`, `experienceType`, …).

### 4. Smaller observations

- The Candlelight page itself calls `getFacilityDetails` (dine-detail) and `getOfferDetails`
  (offerExpiry) on load; the availability call only fires after a search. The authorization header is
  still captured, because the dine-detail call carries it.
- `GET /dine-res/api/calendar-days?facilityId=…` returned 428 on the site's own call. That is another
  reason not to use it.
- Page load makes ~100 script requests and many third-party calls (Akamai sensor POSTs, LaunchDarkly,
  Clicktale, Datadog). None is needed by us.

## Fixtures

`test/fixtures/` holds raw results from this run (scanned for personal data; none found):

- `facility-none-dining-event.json`: Candlelight, 404 `OFFER_NOT_FOUND`.
- `facility-success-restaurant.json`: Chefs de France, 200, the shape in section 3.
- `general-search-success.json`: general search trimmed to 3 restaurants and 2 dining events.

// The site's OneID SDK keeps the bearer token in memory only (not in cookies or storage), and the
// site attaches it as `Authorization: Bearer <JWT>` to every /dine-res/api/ call. We copy the
// header from the site's own requests (it makes some on every page load) and reuse it. The value
// stays in memory: never log it or write it to disk.
const authorizationByPage = new WeakMap();

export function trackAuthorization(page) {
  if (authorizationByPage.has(page)) return;
  authorizationByPage.set(page, null);
  page.on('request', (request) => {
    if (!request.url().includes('/dine-res/api/')) return;
    const authorization = request.headers().authorization;
    if (authorization) authorizationByPage.set(page, authorization);
  });
}

// Runs fetch inside the Disney page so cookies and bot-protection tokens are included.
export async function apiRequest(page, { method = 'GET', path, functionName, body }) {
  const authorization = authorizationByPage.get(page);
  if (!authorization) {
    throw new Error('No Authorization header captured from the site yet (was the page loaded with loadPage?)');
  }
  return page.evaluate(async ({ method, path, functionName, body, authorization }) => {
    window.__dineConversationId ??= crypto.randomUUID();
    const res = await fetch(path, {
      method,
      credentials: 'include',
      headers: {
        accept: 'application/json, text/plain, */*',
        authorization,
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
  }, { method, path, functionName, body, authorization });
}

// The query string is unusual (a literal ";" and "=", entityType twice), so it is built by hand
// rather than with URLSearchParams.
export function getFacilityAvailability(page, { facilityId, entityType, partySize, date }) {
  return apiRequest(page, {
    path: `/dine-res/api/availability/${partySize}/${date}?facilityId=${facilityId};entityType=${entityType}&entityType=${entityType}`,
    functionName: 'getAvailability',
  });
}

export function getGeneralAvailability(page, { partySize, date }) {
  return apiRequest(page, {
    path: `/dine-res/api/availability/${partySize}/${date},${date}/00:00:00,23:59:59?trim=facets,media,webLinks,mediaGalleries,sortProductName&trimExclude=dining-events,diningEvent`,
    functionName: 'getAvailability',
  });
}

export function getDineDetail(page, { slug, entityType }) {
  return apiRequest(page, {
    path: `/dine-res/api/dine-detail/${slug}?entityType=${entityType}`,
    functionName: 'getFacilityDetails',
  });
}

// Not a dine-res call, so it goes out without the dine headers. The site itself sends the guest's
// `swid` and `token` cookie values as headers on this call (a bare fetch gets a 401), so we do the
// same, entirely inside the page; the values are never returned or logged.
export async function isLoggedIn(page) {
  return page.evaluate(async () => {
    try {
      const cookie = (name) => document.cookie.split('; ').find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1);
      const swid = cookie('SWID');
      const token = cookie('TPR-WDW-LBJS.WEB-PROD.token');
      if (!swid || !token) return false;
      const res = await fetch('/api/navigation/profile?isUser=true&brand=wdw&locale=en-us&userType=GUEST', {
        credentials: 'include',
        headers: {
          accept: 'application/json',
          swid: decodeURIComponent(swid),
          token: decodeURIComponent(token),
          'conversation-id': crypto.randomUUID(),
        },
      });
      const json = await res.json();
      return Boolean(json?.user && typeof json.user === 'object');
    } catch {
      return false;
    }
  });
}

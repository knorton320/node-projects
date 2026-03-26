// Handles all API calls to the D&D 5e API (https://www.dnd5eapi.co).
// Exposes functions for fetching monsters. Uses a simple in-memory cache to
// avoid redundant network requests within the same browser session.

const BASE_URL = 'https://www.dnd5eapi.co/api';

/** @type {Map<string, any>} */
const cache = new Map();

/**
 * Internal helper — fetches a URL, reads JSON, and throws a descriptive error
 * on any non-OK response or network failure. Results are cached by URL.
 *
 * @param {string} url
 * @returns {Promise<any>}
 */
async function apiFetch(url) {
  if (cache.has(url)) {
    return cache.get(url);
  }

  let response;
  try {
    response = await fetch(url);
  } catch (networkError) {
    throw new Error(`D&D 5e API network error for "${url}": ${networkError.message}`);
  }

  if (!response.ok) {
    throw new Error(
      `D&D 5e API responded with ${response.status} ${response.statusText} for "${url}"`
    );
  }

  let data;
  try {
    data = await response.json();
  } catch (parseError) {
    throw new Error(`D&D 5e API returned invalid JSON for "${url}": ${parseError.message}`);
  }

  cache.set(url, data);
  return data;
}

/**
 * Fetches the full list of monsters from the D&D 5e API.
 *
 * @returns {Promise<Array<{ index: string, name: string, url: string }>>}
 */
export async function getMonsterList() {
  const data = await apiFetch(`${BASE_URL}/monsters`);
  return data.results;
}

/**
 * Fetches a single monster's full stat block by its index slug.
 *
 * @param {string} index - The monster's API index (e.g. "aboleth", "adult-black-dragon").
 * @returns {Promise<Object>} The full monster object from the API.
 */
export async function getMonster(index) {
  if (!index || typeof index !== 'string') {
    throw new Error(`getMonster requires a non-empty string index, received: ${JSON.stringify(index)}`);
  }
  return apiFetch(`${BASE_URL}/monsters/${encodeURIComponent(index)}`);
}

// All valid D&D 5e CR values — used to iterate the API's per-CR filter endpoint.
const VALID_CRS = [
  0, 0.125, 0.25, 0.5,
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
  11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
];

/**
 * Returns lightweight monster stubs for all monsters in [minCR, maxCR].
 * Uses the API's built-in CR filter — one request per CR value in range,
 * not one per monster. Each stub is annotated with challenge_rating so
 * the UI can display it without a full stat block fetch.
 *
 * @param {number} minCR
 * @param {number} maxCR
 * @returns {Promise<Array<{ index: string, name: string, url: string, challenge_rating: number }>>}
 */
export async function getMonsterListByCR(minCR, maxCR) {
  if (minCR > maxCR) {
    throw new Error(`getMonsterListByCR: minCR (${minCR}) must be <= maxCR (${maxCR})`);
  }

  const crsInRange = VALID_CRS.filter((cr) => cr >= minCR && cr <= maxCR);

  const buckets = await Promise.all(
    crsInRange.map(async (cr) => {
      const data = await apiFetch(`${BASE_URL}/monsters?challenge_rating=${cr}`);
      return (data.results ?? []).map((stub) => ({ ...stub, challenge_rating: cr }));
    })
  );

  return buckets.flat();
}
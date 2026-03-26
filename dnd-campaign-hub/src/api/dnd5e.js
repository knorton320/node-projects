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

/**
 * Returns all monsters whose challenge_rating falls within [minCR, maxCR] (inclusive).
 * Fetches the full monster list first, then retrieves each monster individually.
 * Individual monster fetches are parallelised and cached, so subsequent calls are fast.
 *
 * @param {number} minCR - Minimum challenge rating (inclusive).
 * @param {number} maxCR - Maximum challenge rating (inclusive).
 * @returns {Promise<Object[]>} Array of full monster objects within the CR range.
 */
export async function getMonstersByCR(minCR, maxCR) {
  if (minCR > maxCR) {
    throw new Error(`getMonstersByCR: minCR (${minCR}) must be <= maxCR (${maxCR})`);
  }

  const list = await getMonsterList();

  // Fetch all monsters in parallel, then filter by CR client-side.
  const monsters = await Promise.all(list.map(({ index }) => getMonster(index)));

  return monsters.filter(
    (m) => m.challenge_rating >= minCR && m.challenge_rating <= maxCR
  );
}

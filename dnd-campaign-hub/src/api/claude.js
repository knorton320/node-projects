// Handles communication with the Anthropic Messages API.
// Generates atmospheric D&D scene descriptions from encounter and party context.

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 300;

const SYSTEM_PROMPT = `You are an atmospheric Dungeon Master narrator.
Describe scenes with vivid, immersive prose that sets mood and tension.
Focus only on what the adventurers can see, hear, smell, and feel.
Never reference game mechanics, stat blocks, challenge ratings, hit points, or any numbers.
Keep descriptions concise — two to four sentences.`;

/**
 * Builds the user-facing prompt from encounter context.
 *
 * @param {Object}   params
 * @param {Array<{name: string, challenge_rating: number}>} params.monsters
 * @param {number}   params.partySize
 * @param {number}   params.partyLevel
 * @param {string}   params.setting
 * @returns {string}
 */
function buildPrompt({ monsters, partySize, partyLevel, setting }) {
  const monsterNames = monsters.map((m) => m.name).join(', ');
  return (
    `Setting: ${setting}\n` +
    `A party of ${partySize} adventurers (level ${partyLevel}) encounters: ${monsterNames}.\n` +
    `Narrate the moment they first become aware of the threat.`
  );
}

/**
 * Calls the Anthropic Messages API to generate an atmospheric scene description
 * for a D&D encounter. Returns only the generated text string.
 *
 * @param {Object}   params
 * @param {Array<{name: string, challenge_rating: number}>} params.monsters - Monsters in the encounter.
 * @param {number}   params.partySize  - Number of player characters.
 * @param {number}   params.partyLevel - Average character level.
 * @param {string}   params.setting    - Brief description of the environment (e.g. "dark forest").
 * @returns {Promise<string>} The generated narration text.
 */
export async function generateSceneDescription({ monsters, partySize, partyLevel, setting }) {
  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'Missing VITE_ANTHROPIC_API_KEY. Add it to your .env file (see .env.example).'
    );
  }

  const body = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: buildPrompt({ monsters, partySize, partyLevel, setting }),
      },
    ],
  };

  let response;
  try {
    response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
  } catch (networkError) {
    throw new Error(`Anthropic API network error: ${networkError.message}`);
  }

  if (!response.ok) {
    let detail = '';
    try {
      const errBody = await response.json();
      detail = errBody?.error?.message ?? JSON.stringify(errBody);
    } catch {
      // ignore parse failure on error body
    }
    throw new Error(
      `Anthropic API error ${response.status} ${response.statusText}${
        detail ? `: ${detail}` : ''
      }`
    );
  }

  let data;
  try {
    data = await response.json();
  } catch (parseError) {
    throw new Error(`Anthropic API returned invalid JSON: ${parseError.message}`);
  }

  const text = data?.content?.[0]?.text;
  if (typeof text !== 'string') {
    throw new Error('Anthropic API response did not contain expected text content.');
  }

  return text;
}

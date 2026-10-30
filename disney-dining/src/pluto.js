import { readFileSync } from 'node:fs';

// The dog (src/pluto.txt) is "PLUTO" by NeSS (signature "Ñëss" in its bottom-left corner), from the
// Fate Zero macro collection on patorjk.com's Arial ASCII Art Gallery. It is kept byte-for-byte as
// published. It contains single backticks but never three in a row, so it's safe inside a Discord
// code block. The envelope and speech bubble above it are ours.
const DOG = readFileSync(new URL('./pluto.txt', import.meta.url), 'utf8').trimEnd();

const ENVELOPE = [' ______ ', '|\\    /|', '| \\__/ |', '|______|'];
const SAYS = ['RUFF RUFF! Pluto brought', 'a message for you!'];

// A speech bubble next to the envelope, with a tail pointing down at the dog's head.
function speechBubble(lines, tailColumn) {
  const inner = Math.max(...lines.map((line) => line.length)) + 4;
  const edge = (left, fill, right) => `${left}${fill.repeat(inner)}${right}`;
  const bottom = `'${'-'.repeat(tailColumn - 1)}.${'-'.repeat(inner - tailColumn)}'`;
  const rows = [
    edge('.', '-', '.'),
    ...lines.map((line) => `|  ${line.padEnd(inner - 2)}|`),
    bottom,
  ];
  return rows.map((row, i) => `${(ENVELOPE[i] ?? '        ')}  ${row}`.trimEnd());
}

const TAIL_COLUMN = 10;
const bubble = speechBubble(SAYS, TAIL_COLUMN);
// The envelope and bubble are 4 rows each; one more row carries the tail down toward the head.
const BUBBLE = [...bubble, `${' '.repeat(ENVELOPE[0].length + 2 + TAIL_COLUMN + 1)}'.`].join('\n');

export const PLUTO_DELIVERY = `\n${BUBBLE}\n${DOG}\n`;

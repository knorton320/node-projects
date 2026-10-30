import readline from 'node:readline/promises';
import { loadConfig } from '../src/config.js';
import { openSession } from '../src/browser.js';
import { isLoggedIn } from '../src/disney-api.js';

const { targets } = loadConfig();
const target = targets[0];
if (!target) {
  console.error('No enabled targets in config/targets.json');
  process.exit(1);
}

const url = `https://disneyworld.disney.go.com/dine-res/${target.entityType}/${target.slug}/`;
const { page, close } = await openSession({
  headless: false,
  profileDir: process.env.PROFILE_DIR || 'local/profile',
  url,
});

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
await rl.question(
  'Log in to My Disney Experience in the browser window with the CHECKER account (not your main account). ' +
    'Press Enter here when the page shows you as signed in.\n',
);
rl.close();

console.log(`Logged in: ${await isLoggedIn(page)}`);
await close();

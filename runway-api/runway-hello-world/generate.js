import 'dotenv/config';
import RunwayML, { TaskFailedError } from '@runwayml/sdk';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';

// ── Grab prompt from command line ──────────────────────────────────────────
const prompt = process.argv[2];

if (!prompt) {
  console.error('\n❌  No prompt provided!');
  console.error('Usage: node generate.js "your prompt here"\n');
  process.exit(1);
}

// ── Helper: download a file from a URL to a local path ────────────────────
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', (err) => {
      fs.unlink(destPath, () => {}); // clean up on error
      reject(err);
    });
  });
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const client = new RunwayML();

  console.log('\n🎬  Runway Text-to-Video');
  console.log('─────────────────────────────────────');
  console.log(`📝  Prompt : "${prompt}"`);
  console.log(`🤖  Model  : gen4.5`);
  console.log(`⏱   Duration: 5 seconds`);
  console.log('─────────────────────────────────────');
  console.log('\n⏳  Submitting task to Runway API...');

  try {
    const task = await client.imageToVideo
  .create({
    model: 'gen4.5',
    promptImage: 'https://upload.wikimedia.org/wikipedia/commons/8/85/Tour_Eiffel_Wikimedia_Commons_(cropped).jpg',
    promptText: prompt,
    ratio: '1280:720',
    duration: 5,
  })
  .waitForTaskOutput({
    onProgress: (progress) => {
      const pct = Math.round((progress.progress ?? 0) * 100);
      process.stdout.write(`\r🔄  Generating... ${pct}%   `);
    },
  });

    console.log('\n✅  Generation complete!');

    // ── Save the video ───────────────────────────────────────────────────
    const videoUrl = task.output?.[0];

    if (!videoUrl) {
      console.error('❌  No output URL found in task response.');
      console.log('Full response:', JSON.stringify(task, null, 2));
      process.exit(1);
    }

    // Build a filename from the first few words of the prompt + timestamp
    const slug = prompt
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .trim()
      .split(/\s+/)
      .slice(0, 5)
      .join('_');

    const timestamp = Date.now();
    const filename = `${slug}_${timestamp}.mp4`;
    const outputPath = path.join(process.cwd(), filename);

    console.log(`\n💾  Saving video to: ${filename}`);
    await downloadFile(videoUrl, outputPath);

    console.log('\n🎉  Done! Open the file to watch your video.');
    console.log(`📁  ${outputPath}\n`);

  } catch (error) {
    if (error instanceof TaskFailedError) {
      console.error('\n❌  The generation task failed.');
      console.error('Details:', JSON.stringify(error.taskDetails, null, 2));
    } else {
      console.error('\n❌  Unexpected error:', error.message);
    }
    process.exit(1);
  }
}

main();
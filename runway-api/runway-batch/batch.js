import 'dotenv/config';
import RunwayML, { TaskFailedError } from '@runwayml/sdk';
import fs from 'node:fs';
import https from 'node:https';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Directory setup ────────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMAGES_DIR = path.join(__dirname, 'images');
const OUTPUT_DIR = path.join(__dirname, 'output');

// Create output folder if it doesn't exist
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

// ── Supported image extensions ─────────────────────────────────────────────
const SUPPORTED = ['.jpg', '.jpeg', '.png', '.webp'];

// ── Parse arguments ────────────────────────────────────────────────────────
// Usage:
//   node batch.js "a prompt for all images"
//   node batch.js --csv prompts.csv
function parseArgs() {
  const args = process.argv.slice(2);

  if (args[0] === '--csv') {
    if (!args[1]) {
      console.error('❌  --csv flag requires a filename. Example: node batch.js --csv prompts.csv');
      process.exit(1);
    }
    return { mode: 'csv', csvFile: args[1] };
  }

  if (args[0]) {
    return { mode: 'single', prompt: args[0] };
  }

  console.error('\n❌  No prompt or CSV provided!');
  console.error('Usage:');
  console.error('  node batch.js "your prompt here"');
  console.error('  node batch.js --csv prompts.csv\n');
  process.exit(1);
}

// ── Load prompts from CSV ──────────────────────────────────────────────────
// Expected format:
//   filename,prompt
//   forest.jpg,a cinematic drone shot over a misty forest
function loadCsv(csvFile) {
  const csvPath = path.join(__dirname, csvFile);

  if (!fs.existsSync(csvPath)) {
    console.error(`❌  CSV file not found: ${csvPath}`);
    process.exit(1);
  }

  const lines = fs.readFileSync(csvPath, 'utf-8').trim().split('\n');
  const map = {};

  // Skip header row
  for (const line of lines.slice(1)) {
    const commaIndex = line.indexOf(',');
    if (commaIndex === -1) continue;

    const filename = line.slice(0, commaIndex).trim();
    const prompt   = line.slice(commaIndex + 1).trim();

    if (filename && prompt) map[filename] = prompt;
  }

  return map;
}

// ── Get all images from the images/ folder ─────────────────────────────────
function getImages() {
  if (!fs.existsSync(IMAGES_DIR)) {
    console.error(`❌  No "images" folder found. Create one and drop your images in it.`);
    process.exit(1);
  }

  const files = fs.readdirSync(IMAGES_DIR).filter(f =>
    SUPPORTED.includes(path.extname(f).toLowerCase())
  );

  if (files.length === 0) {
    console.error(`❌  No supported images found in ./images (supported: ${SUPPORTED.join(', ')})`);
    process.exit(1);
  }

  return files;
}

// ── Convert local image to base64 data URI ─────────────────────────────────
function imageToDataUri(filePath) {
  const ext = path.extname(filePath).toLowerCase().replace('.', '');
  const mimeType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
  const data = fs.readFileSync(filePath).toString('base64');
  return `data:${mimeType};base64,${data}`;
}

// ── Download a video from URL to local path ────────────────────────────────
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(destPath);
    protocol.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

// ── Process a single image ─────────────────────────────────────────────────
async function processImage(client, imageFile, prompt, index, total) {
  const label = `[${index + 1}/${total}] ${imageFile}`;
  const imagePath = path.join(IMAGES_DIR, imageFile);
  const baseName  = path.basename(imageFile, path.extname(imageFile));
  const outputPath = path.join(OUTPUT_DIR, `${baseName}.mp4`);

  try {
    console.log(`\n🚀  ${label}`);
    console.log(`     Prompt  : "${prompt}"`);
    console.log(`     Status  : Submitting...`);

    const dataUri = imageToDataUri(imagePath);

    const task = await client.imageToVideo
      .create({
        model: 'gen4_turbo',
        promptImage: dataUri,
        promptText: prompt,
        ratio: '1280:720',
        duration: 5,
      })
      .waitForTaskOutput({
        onProgress: (progress) => {
          const pct = Math.round((progress.progress ?? 0) * 100);
          process.stdout.write(`\r     Status  : Generating... ${pct}%   `);
        },
      });

    const videoUrl = task.output?.[0];
    if (!videoUrl) throw new Error('No output URL in task response');

    process.stdout.write(`\r     Status  : Downloading...          \n`);
    await downloadFile(videoUrl, outputPath);

    console.log(`     ✅  Saved → output/${baseName}.mp4`);
    return { file: imageFile, success: true, output: `${baseName}.mp4` };

  } catch (error) {
    const message = error instanceof TaskFailedError
      ? `Task failed: ${JSON.stringify(error.taskDetails)}`
      : error.message;

    console.log(`\n     ❌  Failed: ${message}`);
    return { file: imageFile, success: false, error: message };
  }
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const args    = parseArgs();
  const images  = getImages();
  const client  = new RunwayML();

  // Build a prompt map: { filename -> prompt }
  let promptMap = {};

  if (args.mode === 'csv') {
    promptMap = loadCsv(args.csvFile);
    // Warn if any images are missing from the CSV
    for (const img of images) {
      if (!promptMap[img]) {
        console.warn(`⚠️   No prompt found for "${img}" in CSV — it will be skipped.`);
      }
    }
  } else {
    // Same prompt for every image
    for (const img of images) promptMap[img] = args.prompt;
  }

  // Only process images that have a prompt
  const toProcess = images.filter(img => promptMap[img]);

  console.log('\n🎬  Runway Batch Processor');
  console.log('─────────────────────────────────────');
  console.log(`📁  Images found : ${images.length}`);
  console.log(`✅  To process   : ${toProcess.length}`);
  console.log(`🤖  Model        : gen4_turbo`);
  console.log(`⏱   Duration     : 5 seconds each`);
  console.log('─────────────────────────────────────');
  console.log('\n⚡  Submitting all jobs concurrently...');

  // Fire all jobs at the same time — Promise.allSettled waits for
  // ALL of them to finish, even if some fail
  const results = await Promise.allSettled(
    toProcess.map((imageFile, index) =>
      processImage(client, imageFile, promptMap[imageFile], index, toProcess.length)
    )
  );

  // ── Summary ──────────────────────────────────────────────────────────────
  const successes = results.filter(r => r.status === 'fulfilled' && r.value.success);
  const failures  = results.filter(r => r.status === 'rejected'  || (r.status === 'fulfilled' && !r.value.success));

  console.log('\n─────────────────────────────────────');
  console.log(`🎉  Batch complete!`);
  console.log(`    ✅  Succeeded : ${successes.length}`);
  console.log(`    ❌  Failed    : ${failures.length}`);

  if (failures.length > 0) {
    console.log('\nFailed files:');
    failures.forEach(r => {
      const val = r.status === 'fulfilled' ? r.value : { file: 'unknown', error: r.reason };
      console.log(`  • ${val.file}: ${val.error}`);
    });
  }

  console.log(`\n📁  Videos saved to: ./output/\n`);
}

main();
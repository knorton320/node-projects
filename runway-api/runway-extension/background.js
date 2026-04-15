// ── background.js ─────────────────────────────────────────────────────────
// This is the extension's "brain" — it runs as a Chrome service worker.
// It creates the right-click menu, calls the Runway API, polls for
// completion, and stores results in chrome.storage so the popup can read them.

const RUNWAY_API  = 'https://api.dev.runwayml.com/v1';
const API_VERSION = '2024-11-06';
const POLL_INTERVAL_MS = 4000; // Check job status every 4 seconds

// ── Create right-click context menu on install ─────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'animateWithRunway',
    title: 'Animate with Runway ✨',
    contexts: ['image'],  // Only show when right-clicking an image
  });
});

// ── Listen for context menu clicks ────────────────────────────────────────
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'animateWithRunway') return;

  const imageUrl = info.srcUrl;
  if (!imageUrl) {
    await setStatus({ status: 'error', error: 'Could not read image URL.' });
    return;
  }

  // Get stored API key and default prompt
  const { apiKey, defaultPrompt } = await chrome.storage.local.get(['apiKey', 'defaultPrompt']);

  if (!apiKey) {
    await setStatus({ status: 'error', error: 'No API key set. Open the extension popup to add your Runway API key.' });
    return;
  }

  const prompt = defaultPrompt || 'cinematic motion, dramatic lighting';

  // Store the job as "pending" immediately so the popup shows something
  await setStatus({
    status: 'pending',
    imageUrl,
    prompt,
    taskId: null,
    videoUrl: null,
    error: null,
    startedAt: Date.now(),
  });

  // Kick off the generation
  await startGeneration(imageUrl, prompt, apiKey);
});

// ── Submit generation task to Runway API ──────────────────────────────────
async function startGeneration(imageUrl, prompt, apiKey) {
  try {
    await setStatus({ status: 'submitting' });

    const response = await fetch(`${RUNWAY_API}/image_to_video`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-Runway-Version': API_VERSION,
      },
      body: JSON.stringify({
        model: 'gen4_turbo',
        promptImage: imageUrl,
        promptText: prompt,
        ratio: '1280:720',
        duration: 5,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || `API error ${response.status}`);
    }

    const taskId = data.id;
    await setStatus({ status: 'generating', taskId, progress: 0 });

    // Start polling for completion
    pollForCompletion(taskId, apiKey);

  } catch (err) {
    await setStatus({ status: 'error', error: err.message });
  }
}

// ── Poll Runway until the task succeeds or fails ──────────────────────────
async function pollForCompletion(taskId, apiKey) {
  try {
    const response = await fetch(`${RUNWAY_API}/tasks/${taskId}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'X-Runway-Version': API_VERSION,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || `Poll error ${response.status}`);
    }

    const { status, progress, output, failure, failureCode } = data;

    if (status === 'SUCCEEDED') {
      const videoUrl = output?.[0];
      await setStatus({ status: 'complete', videoUrl, progress: 1 });

    } else if (status === 'FAILED') {
      throw new Error(failure || failureCode || 'Generation failed');

    } else {
      // Still running — update progress and schedule next poll
      await setStatus({ status: 'generating', progress: progress ?? 0 });
      setTimeout(() => pollForCompletion(taskId, apiKey), POLL_INTERVAL_MS);
    }

  } catch (err) {
    await setStatus({ status: 'error', error: err.message });
  }
}

// ── Helper: write job state to chrome.storage + update icon badge ─────────
async function setStatus(updates) {
  const current = await chrome.storage.local.get('job');
  const job = { ...(current.job || {}), ...updates };
  await chrome.storage.local.set({ job });
  updateBadge(job.status);
}

// ── Update the icon badge based on current status ─────────────────────────
// The badge is the little label that appears on top of the extension icon.
function updateBadge(status) {
  switch (status) {
    case 'pending':
    case 'submitting':
    case 'generating':
      // Pulsing blue dot to show work is happening
      chrome.action.setBadgeText({ text: '…' });
      chrome.action.setBadgeBackgroundColor({ color: '#1f3864' });
      break;

    case 'complete':
      // Green checkmark — video is ready
      chrome.action.setBadgeText({ text: '✓' });
      chrome.action.setBadgeBackgroundColor({ color: '#16a34a' });
      break;

    case 'error':
      // Red exclamation — something went wrong, open the popup to see why
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#b91c1c' });
      break;

    default:
      // Clear the badge when idle
      chrome.action.setBadgeText({ text: '' });
      break;
  }
}
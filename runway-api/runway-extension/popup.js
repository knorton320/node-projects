// ── popup.js ───────────────────────────────────────────────────────────────
// Drives the popup UI. Reads job state from chrome.storage, updates the UI
// to match, and handles settings saves.

let pollTimer = null;

// ── On load ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await refreshStatus();

  // Wire up buttons
  document.getElementById('saveKey').addEventListener('click', saveApiKey);
  document.getElementById('savePrompt').addEventListener('click', savePrompt);
  document.getElementById('downloadBtn').addEventListener('click', downloadVideo);
  document.getElementById('clearError').addEventListener('click', clearJob);
});

// ── Load saved settings into inputs ───────────────────────────────────────
async function loadSettings() {
  const { apiKey, defaultPrompt } = await chrome.storage.local.get(['apiKey', 'defaultPrompt']);

  if (apiKey) {
    const input = document.getElementById('apiKey');
    // Show masked version so user knows a key is saved
    input.placeholder = '••••••••••••  (key saved)';
  }

  if (defaultPrompt) {
    document.getElementById('defaultPrompt').value = defaultPrompt;
  }
}

// ── Save API key ───────────────────────────────────────────────────────────
async function saveApiKey() {
  const val = document.getElementById('apiKey').value.trim();
  if (!val) return;

  await chrome.storage.local.set({ apiKey: val });
  document.getElementById('apiKey').value = '';
  document.getElementById('apiKey').placeholder = '••••••••••••  (key saved)';
  flashButton('saveKey', '✓ Saved!');
}

// ── Save default prompt ────────────────────────────────────────────────────
async function savePrompt() {
  const val = document.getElementById('defaultPrompt').value.trim();
  if (!val) return;

  await chrome.storage.local.set({ defaultPrompt: val });
  flashButton('savePrompt', '✓ Saved!');
}

// ── Briefly change button text to confirm save ─────────────────────────────
function flashButton(id, text) {
  const btn = document.getElementById(id);
  const original = btn.textContent;
  btn.textContent = text;
  btn.classList.add('saved');
  setTimeout(() => {
    btn.textContent = original;
    btn.classList.remove('saved');
  }, 1500);
}

// ── Read job state and update the UI ──────────────────────────────────────
async function refreshStatus() {
  const { job } = await chrome.storage.local.get('job');

  if (!job || job.status === 'idle') {
    showState('idle');
    stopPolling();
    return;
  }

  switch (job.status) {

    case 'pending':
    case 'submitting':
      showState('loading');
      setSourceImage(job.imageUrl);
      setLoadingMessage('Submitting to Runway...', 0);
      startPolling();
      break;

    case 'generating': {
      showState('loading');
      setSourceImage(job.imageUrl);
      const pct = Math.round((job.progress ?? 0) * 100);
      setLoadingMessage(`Generating... ${pct}%`, job.progress ?? 0);
      startPolling();
      break;
    }

    case 'complete':
      showState('complete');
      stopPolling();
      document.getElementById('videoPreview').src = job.videoUrl;
      break;

    case 'error':
      showState('error');
      stopPolling();
      document.getElementById('errorMessage').textContent = job.error || 'Something went wrong.';
      break;
  }
}

// ── Show only the relevant state panel ────────────────────────────────────
function showState(name) {
  ['idle', 'loading', 'complete', 'error'].forEach(s => {
    const el = document.getElementById(`state${capitalize(s)}`);
    el.classList.toggle('hidden', s !== name);
  });
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ── Set the source image thumbnail ────────────────────────────────────────
function setSourceImage(url) {
  if (!url) return;
  const img = document.getElementById('sourceImage');
  img.src = url;
  img.style.display = 'block';
}

// ── Update loading message and progress bar ───────────────────────────────
function setLoadingMessage(msg, progress) {
  document.getElementById('loadingMessage').textContent = msg;
  document.getElementById('progressFill').style.width = `${Math.round((progress ?? 0) * 100)}%`;
}

// ── Poll storage every 2 seconds while a job is running ───────────────────
function startPolling() {
  if (pollTimer) return; // Already polling
  pollTimer = setInterval(refreshStatus, 2000);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// ── Download the completed video ──────────────────────────────────────────
async function downloadVideo() {
  const { job } = await chrome.storage.local.get('job');
  if (!job?.videoUrl) return;

  const timestamp = Date.now();
  chrome.downloads.download({
    url: job.videoUrl,
    filename: `runway_${timestamp}.mp4`,
  });

  // Clear the badge now that the video has been retrieved
  chrome.action.setBadgeText({ text: '' });
}

// ── Clear the current job state ───────────────────────────────────────────
async function clearJob() {
  await chrome.storage.local.set({ job: { status: 'idle' } });
  // Also clear the badge on the icon
  chrome.action.setBadgeText({ text: '' });
  await refreshStatus();
}
/* ── State ───────────────────────────────────────────────────────────────── */
let token = sessionStorage.getItem('shellular_token') || null;
let evtSource = null;
let fullOutput   = '';
let shellStatus  = 'stopped';
let qrRendered   = false;

/* ── DOM helpers ─────────────────────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);

const loginPage     = $('login-page');
const dashPage      = $('dashboard-page');
const loginForm     = $('login-form');
const keyInput      = $('key-input');
const loginBtn      = $('login-btn');
const loginLabel    = $('login-label');
const loginSpinner  = $('login-spinner');
const loginError    = $('login-error');
const toggleVisBtn  = $('toggle-vis');
const eyeOpen       = $('eye-open');
const eyeClosed     = $('eye-closed');
const statusBadge   = $('status-badge');
const restartBtn    = $('restart-btn');
const logoutBtn     = $('logout-btn');
const clearLogBtn   = $('clear-log-btn');
const qrLoading     = $('qr-loading');
const qrReady       = $('qr-ready');
const qrError       = $('qr-error');
const qrErrorMsg    = $('qr-error-msg');
const qrCanvas      = $('qr-canvas');
const logPre        = $('log-pre');

/* ── Routing ─────────────────────────────────────────────────────────────── */
function showLogin() {
  loginPage.classList.remove('hidden');
  dashPage.classList.add('hidden');
  keyInput.focus();
}

function showDashboard() {
  loginPage.classList.add('hidden');
  dashPage.classList.remove('hidden');
  connectStream();
  ensureShellularRunning(); // always start shellular, whether fresh login or returning session
}

/* ── Password visibility toggle ──────────────────────────────────────────── */
toggleVisBtn.addEventListener('click', () => {
  const isPassword = keyInput.type === 'password';
  keyInput.type = isPassword ? 'text' : 'password';
  eyeOpen.classList.toggle('hidden', isPassword);
  eyeClosed.classList.toggle('hidden', !isPassword);
});

/* ── Login ───────────────────────────────────────────────────────────────── */
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const key = keyInput.value.trim();
  if (!key) return;

  loginBtn.disabled = true;
  loginLabel.classList.add('hidden');
  loginSpinner.classList.remove('hidden');
  loginError.classList.add('hidden');

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Login failed');
    }

    token = data.token;
    sessionStorage.setItem('shellular_token', token);
    keyInput.value = '';
    showDashboard();
  } catch (err) {
    loginError.textContent = err.message;
    loginError.classList.remove('hidden');
  } finally {
    loginBtn.disabled = false;
    loginLabel.classList.remove('hidden');
    loginSpinner.classList.add('hidden');
  }
});

/* ── Logout ──────────────────────────────────────────────────────────────── */
logoutBtn.addEventListener('click', async () => {
  if (evtSource) { evtSource.close(); evtSource = null; }
  await fetch('/api/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => {});
  token = null;
  sessionStorage.removeItem('shellular_token');
  fullOutput = '';
  logPre.textContent = '';
  qrPre.textContent = '';
  showLogin();
});

/* ── SSE stream ──────────────────────────────────────────────────────────── */
function connectStream() {
  if (evtSource) { evtSource.close(); }

  evtSource = new EventSource(`/api/stream?t=${Date.now()}`, {});

  // EventSource doesn't support custom headers, so we pass the token
  // as a cookie or query param workaround via a short-lived fetch first.
  // Instead, we do: close the native EventSource approach and use fetch-based SSE.
  evtSource.close();
  evtSource = null;
  startFetchSSE();
}

async function startFetchSSE() {
  try {
    const res = await fetch('/api/stream', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });

    if (res.status === 401) {
      sessionStorage.removeItem('shellular_token');
      token = null;
      showLogin();
      return;
    }

    if (!res.ok || !res.body) {
      setTimeout(startFetchSSE, 3000);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let partial = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      partial += decoder.decode(value, { stream: true });
      const parts = partial.split('\n\n');
      partial = parts.pop(); // keep incomplete last chunk

      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith('data:')) continue;
        try {
          const payload = JSON.parse(line.slice(5).trim());
          handleEvent(payload);
        } catch { /* ignore parse errors */ }
      }
    }
  } catch {
    // Connection dropped — retry after 2s
  }

  setTimeout(startFetchSSE, 2000);
}

/* ── Event handler ───────────────────────────────────────────────────────── */
function handleEvent(payload) {
  if (payload.type === 'status') {
    updateStatus(payload.status);
  } else if (payload.type === 'output') {
    appendOutput(payload.text);
  } else if (payload.type === 'clear') {
    fullOutput = '';
    logPre.textContent = '';
    qrRendered = false;
    setQrState('loading');
  }
}

/* ── Status display ──────────────────────────────────────────────────────── */
function updateStatus(status) {
  shellStatus = status;

  const labels = {
    running:  'Running',
    starting: 'Starting',
    retrying: 'Retrying…',
    stopped:  'Stopped',
    error:    'Error',
  };
  statusBadge.textContent = labels[status] || status;
  statusBadge.className   = `badge badge-${status}`;

  if (status === 'retrying') {
    if (!qrRendered) setQrState('loading');
    return; // keep showing the spinner while we wait
  }

  if (status === 'stopped' || status === 'error') {
    if (!qrRendered) {
      setQrState('error');
      qrErrorMsg.textContent =
        status === 'error'
          ? 'Shellular failed to start. Check the output log for details.'
          : 'Shellular stopped. Click "Try again" to restart.';
    }
  }

  if (status === 'starting') {
    if (!qrRendered) setQrState('loading');
  }

  // Once shellular is running, fetch the QR data and render it
  if (status === 'running' && !qrRendered) {
    fetchAndRenderQR();
  }
}

/* ── QR state machine ────────────────────────────────────────────────────── */
function setQrState(state) {
  qrLoading.classList.toggle('hidden', state !== 'loading');
  qrReady.classList.toggle('hidden', state !== 'ready');
  qrError.classList.toggle('hidden', state !== 'error');
}

/* ── QR rendering ────────────────────────────────────────────────────────── */
async function fetchAndRenderQR() {
  for (let i = 0; i < 8; i++) {
    await new Promise(r => setTimeout(r, i === 0 ? 1000 : 2500));
    try {
      const res = await authFetch('/api/shellular/qr-data');
      if (!res || !res.ok) continue;
      const json = await res.json();
      const qrData = json.qrData;
      if (!qrData) continue;

      // Show the container FIRST so the div has real dimensions when QRCode renders
      setQrState('ready');

      // Wipe any previous render
      qrCanvas.innerHTML = '';

      new QRCode(qrCanvas, {
        text:         qrData,
        width:        220,
        height:       220,
        colorDark:    '#000000',
        colorLight:   '#ffffff',
        correctLevel: QRCode.CorrectLevel.M,
      });
      qrRendered = true;
      return;
    } catch (err) {
      console.warn('fetchAndRenderQR attempt', i, err);
    }
  }
  if (!qrRendered) {
    setQrState('error');
    qrErrorMsg.textContent = 'Could not render QR. Try restarting.';
  }
}

/* ── Output processing ───────────────────────────────────────────────────── */
function appendOutput(text) {
  if (!text) return;
  fullOutput += text;
  logPre.textContent = fullOutput;
  logPre.scrollTop = logPre.scrollHeight;

  // Show manual registration card as soon as rate-limit message appears
  if (text.includes('rate-limited') || text.includes('Registration rate-limited')) {
    rateLimitCount++;
    if (rateLimitCount >= 1) loadManualCard();
  }
}

/* ── Controls ────────────────────────────────────────────────────────────── */
restartBtn.addEventListener('click', restartShellular);

async function restartShellular() {
  fullOutput = '';
  logPre.textContent = '';
  qrRendered = false;
  setQrState('loading');
  await authFetch('/api/shellular/restart', 'POST');
}

clearLogBtn.addEventListener('click', () => {
  logPre.textContent = '';
});

async function authFetch(url, method = 'GET') {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    token = null;
    sessionStorage.removeItem('shellular_token');
    showLogin();
  }
  return res;
}

/* ── Manual registration fallback ───────────────────────────────────────── */
const manualCard      = $('manual-reg-card');
const manualCurlCmd   = $('manual-curl-cmd');
const manualHostInput = $('manual-host-id');
const manualSubmitBtn = $('manual-submit-btn');
const manualError     = $('manual-error');

let rateLimitCount  = 0;
let machineIdLoaded = false;

async function loadManualCard() {
  if (machineIdLoaded) { manualCard.classList.remove('hidden'); return; }
  try {
    const res = await fetch('/api/shellular/machine-id');
    const { machineId } = await res.json();
    const cmd = `curl -s -X POST "https://api.shellular.dev/register" -H "Content-Type: application/json" -d '{"machineId":"${machineId}","platform":"linux"}'`;
    manualCurlCmd.textContent = cmd;
    machineIdLoaded = true;
    manualCard.classList.remove('hidden');
  } catch { /* silent */ }
}

manualSubmitBtn.addEventListener('click', async () => {
  const hostId = manualHostInput.value.trim();
  if (!hostId) {
    manualError.textContent = 'Please enter the hostId from the curl response.';
    manualError.classList.remove('hidden');
    return;
  }
  manualError.classList.add('hidden');
  manualSubmitBtn.disabled = true;
  manualSubmitBtn.textContent = 'Connecting…';

  try {
    const r = await fetch('/api/shellular/seed-host', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ hostId }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Failed');

    manualCard.classList.add('hidden');
    rateLimitCount = 0;
    // shellular is restarting — clear output and show loading
    fullOutput = '';
    logPre.textContent = '';
    qrRendered = false;
    setQrState('loading');
  } catch (err) {
    manualError.textContent = err.message;
    manualError.classList.remove('hidden');
  } finally {
    manualSubmitBtn.disabled = false;
    manualSubmitBtn.textContent = 'Connect';
  }
});

/* ── First-time setup panel ──────────────────────────────────────────────── */
const setupCard  = $('setup-card');
let setupDone    = false;  // true once panel is shown OR secrets are already seeded

async function checkSetup() {
  if (setupDone || !token) return;
  try {
    const r1 = await authFetch('/api/setup-status');
    if (!r1 || !r1.ok) return;
    const { seeded } = await r1.json();
    if (seeded) { setupDone = true; return; } // secrets already saved

    // Try to read credentials (shellular must have registered first)
    const r2 = await authFetch('/api/shellular/credentials');
    if (!r2 || !r2.ok) return; // not ready yet — poll will retry
    const data = await r2.json();
    if (!data.hostId) return;

    // Populate and show the panel
    $('val-host-id').textContent    = data.hostId;
    $('val-machine-id').textContent = data.machineId;
    $('val-key').textContent        = data.keyB64;
    setupCard.classList.remove('hidden');
    setupDone = true;
  } catch { /* retry on next poll */ }
}

// Poll every 4 s so the panel appears as soon as credentials are available,
// regardless of whether the QR has rendered yet.
setInterval(checkSetup, 4000);

// Copy-to-clipboard buttons
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-copy');
  if (!btn) return;
  const val = $( btn.dataset.target )?.textContent || '';
  navigator.clipboard.writeText(val).then(() => {
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
  });
});

/* ── Kick off shellular automatically after login ────────────────────────── */
async function ensureShellularRunning() {
  const res = await authFetch('/api/status');
  if (!res) return;
  const { running } = await res.json();
  if (!running) {
    await authFetch('/api/shellular/start', 'POST');
  }
}

/* ── Init ────────────────────────────────────────────────────────────────── */
// If we have a stored token, try to go straight to the dashboard
if (token) {
  fetch('/api/status', { headers: { Authorization: `Bearer ${token}` } })
    .then((r) => {
      if (r.status === 401) {
        token = null;
        sessionStorage.removeItem('shellular_token');
        showLogin();
      } else {
        showDashboard();
      }
    })
    .catch(() => showLogin());
} else {
  showLogin();
}

// Expose for inline onclick in HTML
window.restartShellular = restartShellular;

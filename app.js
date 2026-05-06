import express from 'express';
import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 7860;
const SECRET_KEY = process.env.SECRET_KEY;

if (!SECRET_KEY) {
  console.error('[ERROR] SECRET_KEY environment variable is not set. Exiting.');
  process.exit(1);
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Session store ─────────────────────────────────────────────────────────────
const sessions = new Set();

// ── ANSI stripper ─────────────────────────────────────────────────────────────
function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g, '');
}

// ── Pre-seed shellular config from env vars ───────────────────────────────────
// If SHELLULAR_HOST_ID and SHELLULAR_KEY are set (as HF Secrets), we write
// them into ~/.shellular/ so shellular skips the registration API call entirely.
// This avoids rate-limit errors during container cold-starts.
function seedShellularConfig() {
  const hostId  = process.env.SHELLULAR_HOST_ID;
  const keyB64  = process.env.SHELLULAR_KEY;       // base64-encoded 32-byte key
  const machineId = process.env.SHELLULAR_MACHINE_ID; // must match registration

  if (!hostId || !keyB64 || !machineId) return;

  const shellularDir = path.join(os.homedir(), '.shellular');
  const configFile   = path.join(shellularDir, 'config.json');
  const keyFile      = path.join(shellularDir, `shellular-${machineId}.e2ee`);

  try {
    fs.mkdirSync(shellularDir, { recursive: true });

    // Write config.json (skips registration on next shellular start)
    if (!fs.existsSync(configFile)) {
      fs.writeFileSync(configFile, JSON.stringify({ hostId, machineId }), 'utf-8');
      console.log(`[shellular] seeded config: hostId=${hostId}`);
    }

    // Write the E2E key file (32 bytes from base64)
    if (!fs.existsSync(keyFile)) {
      fs.writeFileSync(keyFile, Buffer.from(keyB64, 'base64'), { mode: 0o600 });
      console.log(`[shellular] seeded key: ${keyFile}`);
    }
  } catch (err) {
    console.error('[shellular] failed to seed config:', err.message);
  }
}

seedShellularConfig();

// ── Shellular machine-id helper ───────────────────────────────────────────────
// node-machine-id hashes /etc/machine-id with SHA-256.  We replicate that here
// so the frontend can show the correct curl registration command.
function getHashedMachineId() {
  try {
    const raw = fs.readFileSync('/etc/machine-id', 'utf-8').trim();
    return crypto.createHash('sha256').update(raw).digest('hex');
  } catch {
    return null;
  }
}

// Returns the hashed machine-id (safe to expose — not a secret).
app.get('/api/shellular/machine-id', (_req, res) => {
  const id = getHashedMachineId();
  id ? res.json({ machineId: id }) : res.status(500).json({ error: 'Cannot read machine-id' });
});

// Accepts a hostId obtained manually by the user, writes ~/.shellular/config.json,
// and restarts shellular so it skips the registration API entirely.
app.post('/api/shellular/seed-host', requireAuth, (req, res) => {
  const { hostId } = req.body || {};
  if (!hostId || typeof hostId !== 'string' || !hostId.trim()) {
    return res.status(400).json({ error: 'hostId is required' });
  }
  const machineId = getHashedMachineId();
  if (!machineId) return res.status(500).json({ error: 'Cannot read machine-id' });

  try {
    const shellularDir = path.join(os.homedir(), '.shellular');
    fs.mkdirSync(shellularDir, { recursive: true });
    fs.writeFileSync(
      path.join(shellularDir, 'config.json'),
      JSON.stringify({ hostId: hostId.trim(), machineId }, null, 2),
      'utf-8'
    );

    // Restart shellular so it picks up the new config
    stopShellular();
    outputBuffer = '';
    broadcast({ type: 'clear' });
    setTimeout(startShellular, 600);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Auth routes ───────────────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { key } = req.body;
  if (!key || key !== SECRET_KEY) {
    return res.status(401).json({ error: 'Invalid key' });
  }
  const token = crypto.randomUUID();
  sessions.add(token);
  res.json({ token });
});

app.post('/api/logout', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  sessions.delete(token);
  res.json({ ok: true });
});

// ── Auth middleware ────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token || !sessions.has(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ── Shellular process management ──────────────────────────────────────────────
let shellularProc = null;
let outputBuffer  = '';
const sseClients  = new Set();

function send(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function broadcast(payload) {
  const frame = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    client.write(frame);
  }
}

let retryTimer = null;

function startShellular() {
  if (shellularProc || retryTimer) return;

  broadcast({ type: 'status', status: 'starting' });

  shellularProc = spawn('shellular', ['--unknown-clients', 'always-allow'], {
    env: { ...process.env, FORCE_COLOR: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Accumulate stdout/stderr so we can detect the error type on exit
  let procOutput = '';

  const handleData = (chunk) => {
    const text = stripAnsi(chunk.toString());
    procOutput   += text;
    outputBuffer += text;
    broadcast({ type: 'output', text });
  };

  shellularProc.stdout.on('data', handleData);
  shellularProc.stderr.on('data', handleData);

  shellularProc.on('error', (err) => {
    const text = `\n[spawn error] ${err.message}\n`;
    outputBuffer += text;
    broadcast({ type: 'output', text });
    shellularProc = null;
    broadcast({ type: 'status', status: 'error' });
  });

  shellularProc.on('exit', (code, signal) => {
    shellularProc = null;

    // Detect rate-limit / registration failure (exit code 1, no signal)
    const isRegError = code === 1 && !signal &&
      (procOutput.includes('invalid_union') || procOutput.includes('Too many requests') ||
       procOutput.includes('host registration'));

    if (isRegError) {
      const WAIT = 30;
      const msg = `\n⚠ Registration rate-limited by shellular API.\n` +
                  `  Retrying automatically in ${WAIT}s — please wait…\n`;
      outputBuffer += msg;
      broadcast({ type: 'output', text: msg });
      broadcast({ type: 'status', status: 'retrying' });

      retryTimer = setTimeout(() => {
        retryTimer = null;
        const msg2 = '\n[Retrying registration…]\n';
        outputBuffer += msg2;
        broadcast({ type: 'output', text: msg2 });
        startShellular();
      }, WAIT * 1000);
    } else {
      const text = code !== 0
        ? `\n[shellular exited — code=${code ?? '?'}, signal=${signal ?? 'none'}]\n`
        : '\n[shellular disconnected]\n';
      outputBuffer += text;
      broadcast({ type: 'output', text });
      broadcast({ type: 'status', status: 'stopped' });
    }
  });

  broadcast({ type: 'status', status: 'running' });
}

function stopShellular() {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  if (!shellularProc) return;
  shellularProc.kill('SIGTERM');
  shellularProc = null;
}

// ── SSE stream ─────────────────────────────────────────────────────────────────
app.get('/api/stream', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering on HF
  res.flushHeaders();

  send(res, { type: 'status', status: shellularProc ? 'running' : 'stopped' });

  if (outputBuffer) {
    send(res, { type: 'output', text: outputBuffer });
  }

  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

// ── Control endpoints ──────────────────────────────────────────────────────────
app.post('/api/shellular/start', requireAuth, (_req, res) => {
  startShellular();
  res.json({ ok: true, running: !!shellularProc });
});

app.post('/api/shellular/stop', requireAuth, (_req, res) => {
  stopShellular();
  outputBuffer = '';
  broadcast({ type: 'output', text: '' });
  res.json({ ok: true });
});

app.post('/api/shellular/restart', requireAuth, (_req, res) => {
  stopShellular();
  outputBuffer = '';
  broadcast({ type: 'clear' });
  setTimeout(startShellular, 600);
  res.json({ ok: true });
});

app.get('/api/status', requireAuth, (_req, res) => {
  res.json({ running: !!shellularProc });
});

// Tells the frontend whether SHELLULAR_* secrets are already saved.
// If not, the UI shows a first-time setup panel with values to copy into HF Secrets.
app.get('/api/setup-status', requireAuth, (_req, res) => {
  const seeded = !!(
    process.env.SHELLULAR_HOST_ID &&
    process.env.SHELLULAR_KEY &&
    process.env.SHELLULAR_MACHINE_ID
  );
  res.json({ seeded });
});

// Returns the registered hostId + base64 key so they can be saved as HF Secrets.
app.get('/api/shellular/credentials', requireAuth, (_req, res) => {
  try {
    const shellularDir = path.join(os.homedir(), '.shellular');
    const configRaw    = fs.readFileSync(path.join(shellularDir, 'config.json'), 'utf-8');
    const { hostId, machineId } = JSON.parse(configRaw);
    const keyFile = path.join(shellularDir, `shellular-${machineId}.e2ee`);
    const keyB64  = fs.readFileSync(keyFile).toString('base64');
    res.json({ hostId, machineId, keyB64 });
  } catch {
    res.status(404).json({ error: 'Not registered yet.' });
  }
});

// Returns the QR data string ("hostId:keyBase64") for client-side QR rendering.
// This is safe to expose post-auth — the key is shared with the scanning device
// anyway (that is the point of the QR code).
app.get('/api/shellular/qr-data', requireAuth, (_req, res) => {
  try {
    const shellularDir = path.join(os.homedir(), '.shellular');
    const configRaw    = fs.readFileSync(path.join(shellularDir, 'config.json'), 'utf-8');
    const { hostId, machineId } = JSON.parse(configRaw);
    const keyFile = path.join(shellularDir, `shellular-${machineId}.e2ee`);
    const keyB64  = fs.readFileSync(keyFile).toString('base64');
    // Same format shellular itself encodes into the terminal QR
    res.json({ qrData: `${hostId}:${keyB64}` });
  } catch {
    res.status(404).json({ error: 'Config not seeded yet.' });
  }
});

// ── Start ──────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Shellular Web UI → http://0.0.0.0:${PORT}`);
});

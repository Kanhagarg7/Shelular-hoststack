<div align="center">

# Shellular Web UI

A self-hosted web interface for [Shellular](https://shellular.dev) — login with a secret key, get a QR code, scan it with the Shellular app and connect your phone to your environment.

![Node.js](https://img.shields.io/badge/Node.js-20-green?logo=node.js)
![Docker](https://img.shields.io/badge/Docker-ready-blue?logo=docker)
![License](https://img.shields.io/badge/license-MIT-brightgreen)

</div>

---

## Features

- Password-protected login page
- Renders a scannable QR code for the Shellular app
- End-to-end encrypted connection (libsodium)
- One-time setup panel to save permanent credentials
- Manual registration fallback when rate-limited
- Dark theme UI

---

## Architecture

```
Your Phone  ──scan QR──▶  Shellular App
                               │
                    wss://api.shellular.dev
                               │
                         Web UI Server
                      (Node.js + Shellular CLI)
```

---

## Quick Start

### Requirements

- Node.js 20+
- Docker (optional)
- [Shellular app](https://shellular.dev) on your phone

### Run with Docker

```bash
docker build -t shellular-web .
docker run -p 7860:7860 -e SECRET_KEY=yourpassword shellular-web
```

Open `http://localhost:7860`, enter your `SECRET_KEY`, and scan the QR code.

### Run directly

```bash
git clone https://github.com/SyntaxAdi/shellular-web
cd shellular-web
npm install
SECRET_KEY=yourpassword node app.js
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SECRET_KEY` | ✅ Always | Password for the login page |
| `SHELLULAR_HOST_ID` | ⭐ Recommended | Pre-registered host ID — skips registration API on every restart |
| `SHELLULAR_MACHINE_ID` | ⭐ Recommended | Hashed machine ID tied to the registration |
| `SHELLULAR_KEY` | ⭐ Recommended | Base64-encoded 32-byte E2E encryption key |
| `PORT` | Optional | Port to listen on (default: `7860`) |

### Why are `SHELLULAR_*` variables needed?

Shellular calls `api.shellular.dev` to register on every cold start. That API is rate-limited — if the server restarts too often, registration fails and no QR appears. Setting these three variables lets the server reuse the same registered identity on every restart with no API call.

**How to get them:** After your first successful login and QR render, a **⚡ One-time Setup** panel appears on the dashboard with all three values and copy buttons.

---

## Manual Registration (rate-limit fallback)

If the automatic registration is blocked, the dashboard shows a **⚠ Rate Limited** card with a `curl` command. Run it from your own terminal:

```bash
curl -s -X POST "https://api.shellular.dev/register" \
  -H "Content-Type: application/json" \
  -d '{"machineId":"<shown on card>","platform":"linux"}'
```

Paste the returned `hostId` into the input field and click **Connect**.

---

## Project Structure

```
├── app.js              Express server — auth, SSE, shellular lifecycle
├── package.json
├── Dockerfile
└── public/
    ├── index.html      Login page + dashboard
    ├── style.css       Dark theme
    ├── app.js          Frontend JS
    └── qrcode.min.js   Bundled QR renderer
```

---

## Tech Stack

- **Backend** — Node.js, Express, Server-Sent Events
- **Frontend** — Vanilla JS, CSS custom properties
- **QR** — [qrcode.js](https://github.com/davidshimjs/qrcodejs)
- **Shell** — [Shellular CLI](https://shellular.dev)

---

## License

MIT

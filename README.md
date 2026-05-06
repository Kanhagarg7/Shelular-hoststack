---
title: Shellular Web UI
emoji: 🖥️
colorFrom: blue
colorTo: indigo
sdk: docker
pinned: false
---

# Shellular Web UI

A self-hosted web interface that runs **[Shellular](https://shellular.dev)** inside a Hugging Face Space and shows the pairing QR code in your browser — no terminal access needed.

---

## What it does

- Password-protected login page hosted on your HF Space URL
- Starts Shellular automatically after login and renders a scannable QR code
- All traffic between your phone and the host is **end-to-end encrypted** (libsodium)
- One-time setup panel guides you through saving permanent secrets so restarts are instant

---

## Architecture

```
Your Phone  ──scan QR──▶  Shellular App
                               │
                    wss://api.shellular.dev  (relay, E2E encrypted)
                               │
                          HF Space
                    (Node.js + Shellular CLI)
```

---

## Quick Start

### Step 1 — Fork the Space

Click **Duplicate this Space** on the top-right of this Space page.

### Step 2 — Add `SECRET_KEY`

Go to your forked Space → **Settings → Variables and secrets → New secret**

| Name | Value |
|------|-------|
| `SECRET_KEY` | Any strong password — this is the login password for the web UI |

The Space will restart automatically.

### Step 3 — Login

Open your Space URL (`https://your-username-vps.hf.space`), enter your `SECRET_KEY` and click **Login**.

Shellular starts automatically. Within a few seconds the QR code appears.

### Step 4 — Scan the QR code

Install the **Shellular app** on your phone → [shellular.dev](https://shellular.dev)

Open the app and scan the QR code on the dashboard. Your phone is now connected.

### Step 5 — Save the permanent secrets (important!)

After the QR code appears, a **⚡ One-time Setup** panel appears showing three values with **Copy** buttons.

Add all three as secrets in your Space settings:

**Space → Settings → Variables and secrets → New secret**

| Secret name | Where to get it |
|-------------|-----------------|
| `SHELLULAR_HOST_ID` | Copy from the One-time Setup panel |
| `SHELLULAR_MACHINE_ID` | Copy from the One-time Setup panel |
| `SHELLULAR_KEY` | Copy from the One-time Setup panel |

After adding all three, restart the Space. The setup panel disappears permanently.

> **Why are these needed?**
> Shellular calls `api.shellular.dev` to register on every cold start.
> That API is rate-limited — if the Space restarts too often, registration fails
> and the QR never appears. Saving these three values means Shellular reuses the
> same registered identity on every restart with no API call at all.

---

## All Secrets Reference

| Name | Required | Description |
|------|----------|-------------|
| `SECRET_KEY` | ✅ Always | Login password for the web UI. Choose anything strong. |
| `SHELLULAR_HOST_ID` | ⭐ Strongly recommended | The relay server's ID for this host. Shown in the One-time Setup panel. |
| `SHELLULAR_MACHINE_ID` | ⭐ Strongly recommended | Hashed machine identifier tied to the registration. Shown in the One-time Setup panel. |
| `SHELLULAR_KEY` | ⭐ Strongly recommended | 32-byte base64 E2E encryption key. Shown in the One-time Setup panel. |

---

## Troubleshooting

### QR code doesn't appear / "Shellular stopped"

The Shellular registration API was rate-limited.

**Fix:** Save the three `SHELLULAR_*` secrets from the One-time Setup panel (Step 5). Once saved, Shellular skips registration on every restart — no rate limit, instant QR.

If you have not yet seen the One-time Setup panel (e.g. the first registration also failed), wait a few minutes and click **▶ Restart** on the dashboard to try again.

### "Invalid key" on login

`SECRET_KEY` is not set or was typed incorrectly. Check **Settings → Variables and secrets**.

### One-time Setup panel not appearing

The panel only appears after the QR code is successfully rendered for the first time AND the `SHELLULAR_*` secrets are not yet saved. If the QR rendered but the panel did not appear, refresh the page and log in again.

---

## Project Structure

```
├── app.js                  # Express server — auth, SSE, shellular lifecycle
├── package.json
├── Dockerfile              # Node 20-slim, pinned machine-id for stable registration
└── public/
    ├── index.html          # Login page + dashboard (QR, One-time Setup, Output log)
    ├── style.css           # Dark theme
    ├── app.js              # Frontend JS
    └── qrcode.min.js       # Bundled QR renderer (no CDN dependency)
```

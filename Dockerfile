# ── Base image ────────────────────────────────────────────────────────────────
FROM node:20-slim

# ── System dependencies ───────────────────────────────────────────────────────
# python3 / make / g++  — required to compile node-pty (used by shellular)
# python3-pip           — for yt-dlp and other Python tools
# wget / curl           — general-purpose download utilities
# git                   — version control
# neofetch              — system info display
# mediainfo             — media file metadata inspector
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        python3 \
        python3-pip \
        make \
        g++ \
        wget \
        curl \
        git \
        sudo \
        neofetch \
        mediainfo \
        python3-venv \
        screen \
        ca-certificates \
        openssl \
    && rm -rf /var/lib/apt/lists/*

# ── Passwordless sudo for the node user ──────────────────────────────────────
# Lets you run  sudo apt install <pkg>  inside the shellular terminal
# without needing a password.
RUN echo "node ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/node && \
    chmod 0440 /etc/sudoers.d/node

# ── yt-dlp (installed via pip, break-system-packages is fine in a container) ──
RUN pip3 install --no-cache-dir --break-system-packages yt-dlp

# ── Pin a stable machine-id ───────────────────────────────────────────────────
# WHY THIS IS HERE (not in secrets):
#   • The shellular relay authenticates connections by matching the machineId
#     that was used at registration time. The container's /etc/machine-id must
#     always hash to the same value as SHELLULAR_MACHINE_ID in HF Secrets.
#   • /etc/machine-id must be written as root, at BUILD time. HF Spaces runs
#     all containers as UID 1000 at runtime, so it cannot be written then.
#   • This value is a stable identifier, NOT a secret or auth token.
#     The actual secrets (SHELLULAR_KEY, SHELLULAR_HOST_ID) live in HF Secrets.
RUN echo "d8904b4d338adf83688caac869f64c0b" > /etc/machine-id && \
    mkdir -p /var/lib/dbus && \
    echo "d8904b4d338adf83688caac869f64c0b" > /var/lib/dbus/machine-id

# ── Use the built-in "node" user (UID 1000, matches HF Spaces runtime) ────────
USER node
ENV HOME=/home/node \
    PATH="/home/node/.npm-global/bin:${PATH}"

# ── Install shellular globally ────────────────────────────────────────────────
RUN npm config set prefix /home/node/.npm-global && \
    npm install -g shellular

# ── App ───────────────────────────────────────────────────────────────────────
WORKDIR /home/node/app

COPY --chown=node:node package*.json ./
RUN npm install --omit=dev

COPY --chown=node:node . .

# ── Runtime ───────────────────────────────────────────────────────────────────
EXPOSE 7860
ENV PORT=7860

CMD ["node", "app.js"]

FROM node:20-slim

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
        gosu \
        neofetch \
        mediainfo \
        python3-venv \
        screen \
        ca-certificates \
        openssl \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install --no-cache-dir --break-system-packages yt-dlp

RUN echo "node ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/node && \
    chmod 0440 /etc/sudoers.d/node

RUN python3 -c "import secrets; print(secrets.token_hex(16), end='')" > /etc/machine-id && \
    mkdir -p /var/lib/dbus && \
    cp /etc/machine-id /var/lib/dbus/machine-id && \
    echo "AkenoChanXD" > /etc/hostname

RUN npm install -g shellular@0.0.19

WORKDIR /home/node/app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .
RUN chown -R node:node /home/node/app

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# ── Environment Configuration (Running as root) ──────────────────────────────
ENV HOME=/root \
    PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
    HOSTNAME=AkenoChanXD \
    PORT=10000

# ── Override shell prompt to always show root@AkenoChanXD ──────────────────────
RUN echo 'export PS1="root@AkenoChanXD:\w\$ "' >> /root/.bashrc

EXPOSE 10000

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "app.js"]

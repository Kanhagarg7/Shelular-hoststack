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

RUN echo "d8904b4d338adf83688caac869f64c0b" > /etc/machine-id && \
    mkdir -p /var/lib/dbus && \
    echo "d8904b4d338adf83688caac869f64c0b" > /var/lib/dbus/machine-id

USER node
ENV HOME=/home/node \
    PATH="/home/node/.npm-global/bin:${PATH}"

RUN npm config set prefix /home/node/.npm-global && \
    npm install -g shellular

WORKDIR /home/node/app

COPY --chown=node:node package*.json ./
RUN npm install --omit=dev

COPY --chown=node:node . .

EXPOSE 7860
ENV PORT=7860

CMD ["node", "app.js"]

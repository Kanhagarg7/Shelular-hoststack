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

RUN echo "d8904b4d338adf83688caac869f64c0b" > /etc/machine-id && \
    mkdir -p /var/lib/dbus && \
    echo "d8904b4d338adf83688caac869f64c0b" > /var/lib/dbus/machine-id && \
    echo "AkenoChanXD" > /etc/hostname

RUN npm install -g shellular

WORKDIR /home/node/app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .
RUN chown -R node:node /home/node/app

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 10000
ENV PORT=10000 \
    HOSTNAME=AkenoChanXD \
    HOME=/home/node \
    PATH="/usr/local/bin:/usr/bin:/bin"

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "app.js"]

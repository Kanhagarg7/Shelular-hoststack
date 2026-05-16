# ── Base image ────────────────────────────────────────────────────────────────
FROM node:20-slim


# ── System dependencies ───────────────────────────────────────────────────────
RUN apt-get update && apt-get upgrade -y && \
    apt-get install -y --no-install-recommends \
        python3 \
        python3-pip \
        python3-venv \
        make \
        g++ \
        wget \
        curl \
        git \
        neofetch \
        mediainfo \
        screen \
        nano \
        rsync \
    && rm -rf /var/lib/apt/lists/*


# ── Generate a unique 64-char Machine ID ─────────────────────────────────────
# This creates a valid, random 64-character hex string (SHA-256 format)
RUN mkdir -p /var/lib/dbus && \
    head -c 512 /dev/urandom | sha256sum | cut -d' ' -f1 > /etc/machine-id && \
    cp /etc/machine-id /var/lib/dbus/machine-id


USER root


# ── Set HOME and PATH ─────────────────────────────────────────────────────────
ENV HOME=/root \
    PATH="/root/venv/bin:/usr/local/bin:${PATH}" \
    VIRTUAL_ENV=/root/venv \
    PIP_NO_CACHE_DIR=1 \
    HOSTNAME=kanha


# ── Install shellular globally ────────────────────────────────────────────────
RUN npm install -g --prefix /usr/local shellular


# ── Create Python venv ────────────────────────────────────────────────────────
RUN python3 -m venv /root/venv && \
    /root/venv/bin/pip install --upgrade pip && \
    /root/venv/bin/pip install huggingface_hub && \
    rm -f /root/venv/lib/python*/EXTERNALLY-MANAGED


# ── Shell config ──────────────────────────────────────────────────────────────
RUN echo 'export PS1="\u@kanha:\w\$ "' >> /root/.bashrc && \
    echo 'cd /data' >> /root/.bashrc && \
    echo 'cd /data' >> /root/.bash_profile


# ── Force pip/python → always use /root/venv ─────────────────────────────────
RUN printf '%s\n' '#!/bin/sh' 'exec /root/venv/bin/pip "$@"'     > /usr/local/bin/pip     && chmod +x /usr/local/bin/pip     && \
    printf '%s\n' '#!/bin/sh' 'exec /root/venv/bin/pip3 "$@"'    > /usr/local/bin/pip3    && chmod +x /usr/local/bin/pip3    && \
    printf '%s\n' '#!/bin/sh' 'exec /root/venv/bin/python "$@"'  > /usr/local/bin/python  && chmod +x /usr/local/bin/python  && \
    printf '%s\n' '#!/bin/sh' 'exec /root/venv/bin/python3 "$@"' > /usr/local/bin/python3 && chmod +x /usr/local/bin/python3


# ── apt/apt-get wrapper → saves installed packages to /data/apt.txt ──────────
RUN printf '%s\n' \
    '#!/bin/sh' \
    'APT_FILE="/data/apt.txt"' \
    'REAL_BIN="$1"' \
    'shift' \
    'if [ "$1" = "install" ]; then' \
    '    shift' \
    '    "$REAL_BIN" install "$@"' \
    '    STATUS=$?' \
    '    if [ $STATUS -eq 0 ]; then' \
    '        touch "$APT_FILE"' \
    '        for arg in "$@"; do' \
    '            case "$arg" in -*) continue ;; esac' \
    '            if ! grep -qx "$arg" "$APT_FILE"; then' \
    '                echo "$arg" >> "$APT_FILE"' \
    '            fi' \
    '        done' \
    '    fi' \
    '    exit $STATUS' \
    'fi' \
    '"$REAL_BIN" "$@"' \
    > /usr/local/bin/_apt_wrapper && chmod +x /usr/local/bin/_apt_wrapper


RUN printf '%s\n' '#!/bin/sh' 'exec /usr/local/bin/_apt_wrapper /usr/bin/apt "$@"' \
    > /usr/local/bin/apt && chmod +x /usr/local/bin/apt
RUN printf '%s\n' '#!/bin/sh' 'exec /usr/local/bin/_apt_wrapper /usr/bin/apt-get "$@"' \
    > /usr/local/bin/apt-get && chmod +x /usr/local/bin/apt-get


# ── Create entrypoint script ──────────────────────────────────────────────────
RUN printf '%s\n' \
    '#!/bin/sh' \
    'set -e' \
    'exec "$@"' \
    > /usr/local/bin/docker-entrypoint.sh && \
    chmod +x /usr/local/bin/docker-entrypoint.sh


# ── Ensure /data exists ───────────────────────────────────────────────────────
RUN mkdir -p /data


# ── Git safe directory fix ────────────────────────────────────────────────────
RUN git config --system --add safe.directory '*'


# ── App ───────────────────────────────────────────────────────────────────────
# Note: Ensure package.json exists in your build context
COPY package*.json /root/app/
RUN cd /root/app && npm install --omit=dev
COPY . /root/app/


# ── Runtime ───────────────────────────────────────────────────────────────────
WORKDIR /data
EXPOSE 7860
ENV PORT=7860
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]


CMD ["bash", "-c", "\
    { \
        chown -R root:root /data 2>/dev/null; \
        chmod -R 755 /data 2>/dev/null; \
        git config --global --add safe.directory '*' 2>/dev/null; \
        if [ -f /data/apt.txt ]; then \
            apt-get update -qq 2>/dev/null; \
            while IFS= read -r pkg || [ -n \"$pkg\" ]; do \
                [ -z \"$pkg\" ] && continue; \
                apt-get install -y -qq \"$pkg\" 2>/dev/null || true; \
            done < /data/apt.txt; \
        fi \
    } & \
    exec node /root/app/app.js"]

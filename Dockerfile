FROM oven/bun:1.4.3 AS bun
FROM ghcr.io/sagernet/sing-box:v1.14.2@sha256:afbffd294c5eb3519cc7b4587299ef189bb0a2ca2f667cb6301fdb6b9bce9558 AS proxy

FROM node:24-bookworm-slim AS builder
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile --ignore-scripts
RUN bun run package

FROM node:24-bookworm-slim AS runtime
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY --from=proxy /usr/local/bin/sing-box /usr/local/bin/sing-box
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl git bash python3 libicu-dev iproute2 iptables nftables util-linux tini chromium fonts-noto-cjk fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ARG SOURCE_COMMIT=development
ARG RELEASE_SEQUENCE=0.0
LABEL org.opencontainers.image.source="https://github.com/sunnypsk/AionUI_Edu" \
    org.opencontainers.image.revision="$SOURCE_COMMIT" \
    org.opencontainers.image.licenses="Apache-2.0" \
    uk.littlething.aionui-edu.release-sequence="$RELEASE_SEQUENCE"
COPY --from=builder /app/package.json /app/bun.lock ./
COPY --from=builder /app/LICENSE ./LICENSE
COPY --from=builder /app/patches ./patches
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/scripts/webui.ts ./scripts/webui.ts
RUN bun install --production --frozen-lockfile --ignore-scripts
COPY --from=builder /app/out/renderer ./out/renderer

# Pinned official AionCore archives; checksums come from the v0.2.2 release metadata.
ARG TARGETARCH
RUN set -eu; \
    case "$TARGETARCH" in \
      amd64) core_arch=x86_64; core_sha=1c3f241c7deff8e9d6da189c1017e6b12df7b538a1f557276c79b3c33d257335 ;; \
      arm64) core_arch=aarch64; core_sha=e9bbb4a6f909cd14aa8b3d78a5c139557c2063930d155f6102df424d27155292 ;; \
      *) exit 1 ;; \
    esac; \
    curl --fail --location --retry 3 "https://github.com/iOfficeAI/AionCore/releases/download/v0.2.2/aioncore-v0.2.2-$core_arch-unknown-linux-gnu.tar.gz" -o /tmp/aioncore.tar.gz; \
    printf '%s  %s\n' "$core_sha" /tmp/aioncore.tar.gz | sha256sum --check --status; \
    mkdir /tmp/aioncore-unpack; \
    tar -xzf /tmp/aioncore.tar.gz -C /tmp/aioncore-unpack; \
    core_binary="$(find /tmp/aioncore-unpack -type f -name aioncore -print -quit)"; \
    test -n "$core_binary"; \
    install -m 755 "$core_binary" /usr/local/bin/aioncore; \
    rm -rf /tmp/aioncore.tar.gz /tmp/aioncore-unpack

ENV NODE_ENV=production \
    AIONUI_CONTAINER=1 \
    AIONUI_DATA_DIR=/data \
    AIONUI_BACKEND_BIN=/usr/local/bin/aioncore \
    AIONUI_NO_BUILD=1 \
    AIONUI_BROWSER_EXECUTABLE=/usr/bin/chromium \
    AIONUI_LOG_LEVEL=info \
    AIONUI_PORT=25808 \
    CODEX_HOME=/data/codex \
    AIONUI_SOURCE_COMMIT=$SOURCE_COMMIT \
    AIONUI_RELEASE_SEQUENCE=$RELEASE_SEQUENCE \
    PUID=99 \
    PGID=100
VOLUME ["/data"]
EXPOSE 25808
HEALTHCHECK --interval=15s --timeout=5s --start-period=90s --retries=3 CMD curl --fail --silent http://127.0.0.1:25808/healthz > /dev/null || exit 1
ENTRYPOINT ["/usr/bin/tini", "--", "bun", "/app/packages/web-host/src/runtime/container.ts"]

FROM oven/bun:1.4.3 AS bun
FROM ghcr.io/sagernet/sing-box:v1.14.2@sha256:afbffd294c5eb3519cc7b4587299ef189bb0a2ca2f667cb6301fdb6b9bce9558 AS proxy

FROM node:24-bookworm-slim AS builder
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile --ignore-scripts
RUN bun run package

FROM rust:1.95.0-bookworm AS core-builder
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN apt-get update \
    && apt-get install -y --no-install-recommends cmake clang libssl-dev pkg-config patch \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /source
COPY packages/web-host/openui ./packages/web-host/openui
ARG TARGETARCH
ENV CARGO_TARGET_DIR=/build-target \
    AIONUI_OPENUI_CORE_OUTPUT=/output/aioncore
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,id=openui-core-${TARGETARCH},target=/build-target \
    bun packages/web-host/openui/core/build.ts

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

# Built natively for each requested Linux architecture from the pinned source and patch set.
COPY --from=core-builder /output/aioncore /usr/local/bin/aioncore
COPY --from=core-builder /output/aioncore.json /usr/local/share/aioncore/build.json

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

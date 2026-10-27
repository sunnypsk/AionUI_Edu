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
    && apt-get install -y --no-install-recommends cmake clang libssl-dev pkg-config patch python3 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /source
COPY packages/web-host/openui ./packages/web-host/openui
ARG TARGETARCH
ENV CARGO_TARGET_DIR=/build-target \
    AIONUI_OPENUI_CORE_OUTPUT=/output/aioncore
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,id=openui-core-${TARGETARCH},target=/build-target \
    bun packages/web-host/openui/core/build.ts --test-idle

FROM node:24-bookworm-slim AS runtime
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY --from=proxy /usr/local/bin/sing-box /usr/local/bin/sing-box
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl git bash bubblewrap python3 python3-venv ffmpeg libicu-dev iproute2 iptables nftables util-linux tini chromium fonts-noto-cjk fonts-noto-color-emoji tzdata \
    && bwrap --version \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY packages/web-host/src/audio/providers/requirements.txt /opt/aionui-audio-requirements.txt
RUN python3 -m venv /opt/aionui-audio \
    && /opt/aionui-audio/bin/python -m pip install --no-cache-dir --disable-pip-version-check -r /opt/aionui-audio-requirements.txt
ARG SOURCE_COMMIT=development
ARG RELEASE_SEQUENCE=0.0
ARG TARGETARCH
# Pinned Factory CLI. Baseline x64 also runs on NAS CPUs without AVX2.
RUN case "$TARGETARCH" in \
      amd64) droid_arch=x64-baseline; droid_sha=44b9ac7f2b87c5f4e364b7a08d8963432df1a71f4793bc14ec15a52f48ff3964 ;; \
      arm64) droid_arch=arm64; droid_sha=7a26c17e17d5822cdeb5cf5f0fa35688fe5260747bd4b5331d293e4fcac93518 ;; \
      *) exit 1 ;; \
    esac \
    && curl --fail --silent --show-error --location --retry 3 "https://downloads.factory.ai/factory-cli/releases/0.245.1/linux/$droid_arch/droid" -o /usr/local/bin/droid \
    && printf '%s  /usr/local/bin/droid\n' "$droid_sha" | sha256sum --check - \
    && chmod 0755 /usr/local/bin/droid
LABEL org.opencontainers.image.source="https://github.com/sunnypsk/AionUI_Edu" \
    org.opencontainers.image.revision="$SOURCE_COMMIT" \
    org.opencontainers.image.licenses="Apache-2.0" \
    uk.littlething.aionui-edu.release-sequence="$RELEASE_SEQUENCE"
COPY --from=builder /app/package.json /app/bun.lock ./
COPY --from=builder /app/LICENSE ./LICENSE
COPY --from=builder /app/packages/web-host/package.json ./packages/web-host/package.json
RUN bun install --production --frozen-lockfile --ignore-scripts
COPY --from=builder /app/packages/web-host/src ./packages/web-host/src
COPY --from=builder /app/packages/desktop/src/common/types/platform/cliModels.ts ./packages/desktop/src/common/types/platform/cliModels.ts
COPY --from=builder /app/packages/desktop/src/common/types/platform/audioTools.ts ./packages/desktop/src/common/types/platform/audioTools.ts
COPY --from=builder /app/packages/desktop/src/common/types/platform/listeningProject.ts ./packages/desktop/src/common/types/platform/listeningProject.ts
COPY --from=builder /app/packages/web-host/openui ./packages/web-host/openui
COPY --from=builder /app/packages/web-host/docker ./packages/web-host/docker
COPY --from=builder /app/scripts/webui.ts /app/scripts/resetpass.ts ./scripts/
COPY --from=builder /app/out/renderer ./out/renderer
COPY --from=builder /app/dist-server ./dist-server

# Built natively for each requested Linux architecture from the pinned source and patch set.
COPY --from=core-builder /output/aioncore /usr/local/bin/aioncore
COPY --from=core-builder /output/aioncore.json /usr/local/share/aioncore/build.json

ENV NODE_ENV=production \
    TZ=Asia/Hong_Kong \
    AIONUI_CONTAINER=1 \
    AIONUI_APP_ROOT=/app \
    AIONUI_CODEX_IDLE_TTL_MS=1800000 \
    TOKIO_WORKER_THREADS=4 \
    AIONUI_DATA_DIR=/data \
    AIONUI_UPLOAD_DIR=/data/uploads \
    AIONUI_BACKEND_BIN=/usr/local/bin/aioncore \
    AIONUI_NO_BUILD=1 \
    AIONUI_BROWSER_EXECUTABLE=/usr/bin/chromium \
    AIONUI_BUNDLED_DROID=/usr/local/bin/droid \
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
ENTRYPOINT ["/usr/bin/tini", "--", "node", "/app/dist-server/host/container.mjs"]

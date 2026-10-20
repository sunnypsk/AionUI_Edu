# Deploy the Unraid WebUI

The supported server deployment is the `linux/amd64` Docker WebUI on Unraid. Use the [maintained deployment, proxy, backup and rollback guide](../../packages/web-host/docker/README.md) for the exact container settings and NAS updater workflow.

The image identity remains `ghcr.io/sunnypsk/aionui_edu`. Publication keeps the existing `stable`, revision tags, source revision, digest and release sequence contracts. The container exposes port `25808`, `/api`, `/ws` and `/healthz`; persistent data remains under `/data`.

Core, Codex CLI, sandboxed Chromium, fonts, Node, Bun and sing-box are included. Desktop installers, display-server/Xvfb setup and standalone download packages are no longer part of deployment.

Build and verify a candidate before publishing or deploying it. The image check in `packages/web-host/docker/checkContainer.py` exercises a disposable container, production dependencies, shared Chromium, SOCKS5/DNS routing and proxy failure handling. The NAS updater tests preserve active-task deferral, snapshot and rollback behavior.

For local browser development, use the [WebUI guide](webui.md). Local build and test success does not establish a published image or a successful NAS rollout; verify each release boundary separately.

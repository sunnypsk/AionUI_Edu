# WebUI workflows

`build-and-release.yml` validates main and builds the `linux/amd64` Unraid image. It publishes to GHCR only after the image passes the existing container/network gate. Source revision labels, release sequence, immutable revision tags, `stable`, and digest-pinned NAS updates retain their existing contracts.

`pr-checks.yml` runs browser/server quality, unit/deployment tests and the SPA build on pull requests. `pr-checks-docs.yml` retains the documentation checks. Repository issue/review automation remains independent of image publication.

Native desktop builds, signing, installer artifacts and standalone Web CLI releases have been removed. No workflow has NAS credentials, and the application container does not receive the Docker socket.

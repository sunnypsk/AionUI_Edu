# Chromium sandbox policy

`seccomp.json` is the Docker profile from Playwright v1.59.1, allowing the user namespaces needed by Chromium while retaining the default syscall restrictions. The browser runs as the existing unprivileged app user with Chromium sandboxing enabled. No public CDP endpoint, desktop server, `--no-sandbox`, `SYS_ADMIN`, or privileged container is used.

Source: https://github.com/microsoft/playwright/blob/v1.59.1/utils/docker/seccomp_profile.json

When updating this profile, review its syscall changes and update the canonical JSON SHA256 in the NAS deployer. The profile stays outside the agent-writable data mount on the NAS.

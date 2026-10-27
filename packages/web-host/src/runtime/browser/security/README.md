# Chromium and Codex sandbox policy

`seccomp.json` is derived from the Docker profile from Playwright v1.59.1, allowing the user namespaces needed by Chromium. It also allows `mount`, `pivot_root`, and `umount2` so Codex's bubblewrap sandbox can construct its filesystem inside an unprivileged user namespace. Without these calls, namespace creation succeeds but sandbox startup fails with `Failed to make / slave: Operation not permitted`.

All other syscall rules remain inherited from that profile. The existing unprivileged application user and `no-new-privileges` remain in place; Chromium sandboxing stays enabled and Codex's requested sandbox policy is preserved. These syscall allowances do not grant `CAP_SYS_ADMIN` in the outer container; kernel namespace and capability checks still apply. No public CDP endpoint, desktop server, `--no-sandbox`, `SYS_ADMIN`, or privileged container is used.

Source: https://github.com/microsoft/playwright/blob/v1.59.1/utils/docker/seccomp_profile.json

When updating this profile, review its syscall changes and update the canonical JSON SHA256 in the NAS deployer. The profile stays outside the agent-writable data mount on the NAS. Update the installed deployer and policy together, then recreate the container to load the new rules; replacing the image alone does not update the host policy.

`checkContainer.py` runs the bundled Codex CLI as UID/GID `99:100`, using a temporary workspace and empty Codex home on its disposable data volume. It requires a workspace write to succeed and writes outside the workspace and inside `.git` to fail without changing the protected files. This complements the sandboxed Chromium and proxy routing checks; `bwrap --version` alone does not prove sandbox startup works.

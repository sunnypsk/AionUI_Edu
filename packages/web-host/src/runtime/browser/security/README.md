# Chromium and Codex sandbox policy

`seccomp.json` is derived from the Docker profile from Playwright v1.59.1, allowing the user namespaces needed by Chromium. It also allows `mount`, `pivot_root`, and `umount2` so Codex's bubblewrap sandbox can construct its filesystem inside an unprivileged user namespace. Without these calls, namespace creation succeeds but sandbox startup fails with `Failed to make / slave: Operation not permitted`.

All other syscall rules remain inherited from that profile. The existing unprivileged application user and `no-new-privileges` remain in place; Chromium sandboxing stays enabled and Codex's requested sandbox policy is preserved. These syscall allowances do not grant `CAP_SYS_ADMIN` in the outer container; kernel namespace and capability checks still apply. No public CDP endpoint, desktop server, `--no-sandbox`, `SYS_ADMIN`, or privileged container is used.

Source: https://github.com/microsoft/playwright/blob/v1.59.1/utils/docker/seccomp_profile.json

When updating this profile, review its syscall changes and update the canonical JSON SHA256 in the NAS deployer. The profile stays outside the agent-writable data mount on the NAS. Update the installed deployer and policy together, then recreate the container to load the new rules; replacing the image alone does not update the host policy.

`checkContainer.py` runs the bundled Codex CLI as UID/GID `99:100`, using a temporary workspace and empty Codex home on its disposable data volume. It requires a workspace write to succeed and writes outside the workspace and inside `.git` to fail without changing the protected files. This complements the sandboxed Chromium and proxy routing checks; `bwrap --version` alone does not prove sandbox startup works.

## AppArmor hosts

Docker's `docker-default` AppArmor profile independently denies `mount`. On hosts such as the Ubuntu CI runner, this produces `Failed to make / slave: Permission denied` even with the correct seccomp policy. Docker Desktop validation without AppArmor does not cover this layer.

`apparmor.profile` defines the separate `aionui-sandbox` profile, derived from [Docker's default profile](https://github.com/moby/profiles/blob/main/apparmor/template.go). It permits mount, pivot-root and unmount operations for nested sandboxes while retaining the default procfs/sysfs write restrictions and same-profile signal/ptrace rules. It does not grant outer-container capabilities; keep the existing seccomp policy, non-root application user and `no-new-privileges` enabled.

On an AppArmor-enabled host, load the profile with `sudo apparmor_parser -r packages/web-host/src/runtime/browser/security/apparmor.profile` and add `--security-opt apparmor=aionui-sandbox` to this application's container (or `apparmor=aionui-sandbox` under Compose `security_opt`). Recreate the container after selecting the profile. Do not replace `docker-default` globally or disable AppArmor. Hosts without AppArmor do not need this option; the Unraid deployer is unchanged.

The CI job loads this profile for its disposable smoke-test container and unloads it after cleanup. `checkContainer.py` detects daemon AppArmor support, requires the named profile in enforce mode, and still runs the real Codex write-boundary and sandboxed Chromium checks. A missing profile is an error, with no unconfined fallback.

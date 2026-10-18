# AionUI_Edu on Unraid

This image includes AionCore, Codex CLI, and sing-box. Each chat remains a separate Codex session. The Codex account and proxy settings are shared by this container's WebUI users. Use separate containers and data directories if separate accounts are needed.

## GitHub Actions and GHCR releases

The existing **Build and Release** workflow now also runs on pushes to `main` and manual dispatch. Its WebUI jobs use standard GitHub-hosted Linux runners. They scan the Git-visible source with a checksum-pinned Gitleaks, run the project's quality/unit checks and deployment tests, build `linux/amd64`, and exercise a disposable SOCKS5 network before publication. The network gate checks TCP to a separate test network and DNS through SOCKS5, bound-interface and attached-subnet bypass attempts, proxy outage, and tunnel crash.

Only a passing image is published to `ghcr.io/sunnypsk/aionui_edu:stable`. A unique tag includes the full source commit, run number and attempt. The image records its source revision and release sequence; `/healthz` verifies AionCore is reachable and reports that revision. The NAS deployer pins the registry digest. No Codex or SOCKS5 credentials are provided to Actions or the image build; publishing uses the job's temporary `GITHUB_TOKEN`.

Standard hosted runner use in public repositories is [free](https://docs.github.com/en/billing/concepts/product-billing/github-actions). GHCR image storage/bandwidth is [currently free](https://docs.github.com/en/billing/concepts/product-billing/github-packages). Package visibility is independent of repository visibility: the initial package defaults to private. Make the package public to allow anonymous NAS pulls, or configure registry authentication on the NAS separately.

Before pushing, run `python3 packages/web-host/docker/releaseChecks.py` to scan tracked and non-ignored new files, and `python3 packages/web-host/docker/releaseChecks.py history` after committing to scan `origin/main..HEAD`. Both produce redacted results. Use the project's `just push` gate for the actual push. The Docker build context excludes local agent settings, cloud/SSH credentials, dotenv files, OAuth stores, proxy configuration and runtime data.

## Reviewed NAS installation and updates

This follows the DSE game's NAS-side registry polling pattern. Build jobs stay on GitHub; the NAS runs a separately reviewed, locally installed updater. The updater only manages `aionui-edu`, its own candidate/rollback containers, and its own paths. It never receives code through the running agent container and never mounts the Docker socket into that container.

The NAS layout keeps deployment authority outside the agent's data mount:

| Host path                                    | Purpose                                                | Mounted in the app |
| -------------------------------------------- | ------------------------------------------------------ | ------------------ |
| `/mnt/user/appdata/aionui-edu/data`          | Chats, files, Codex auth and proxy configuration       | `/data`            |
| `/mnt/user/appdata/aionui-edu/deployment`    | Host-only settings and release journal                 | No                 |
| `/mnt/user/appdata/aionui-edu/backups`       | Stopped-service data snapshots and failed-release data | No                 |
| `/boot/config/plugins/aionui-edu-autodeploy` | Reviewed updater code                                  | No                 |

After a successful GHCR publication, copy the reviewed `deployUnraid.py` to the NAS and compare its SHA256 with the source checkout before running it. Prepare `deployment/settings.json`, owner-only, with this shape (replace the documentation address with the NAS LAN address):

```json
{ "bindAddress": "192.0.2.10", "port": 25808, "puid": 99, "pgid": 100 }
```

Configure the authenticated proxy **in the NAS terminal**, before first startup:

```bash
python3 deployUnraid.py --configure-proxy SOCKS-HOSTNAME:1080
```

The helper hides both username and password, verifies SOCKS5 authentication, resolves the server on the NAS host, and writes the IP-based URL into owner-only `/data/network-proxy.json`. Credentials are never printed or passed as command arguments. The hostname resolution happens outside the app container, before its routing starts. If the provider changes its IP, rerun this helper and restart the app during an idle maintenance window.

First installation:

```bash
python3 deployUnraid.py --install
```

The installer refuses a conflicting container/template/port or missing proxy configuration. It starts an isolated candidate with only a copy of the proxy configuration, verifies the build and external connectivity, then starts production. It writes a digest-pinned Unraid template and installs a five-minute cron **paused**. Its initial LAN address is printed after verification. `compose.nas.yaml` describes the equivalent image-only deployment for manual Compose use; preconfigure proxy data before starting it.

For a reviewed manual update with no active work:

```bash
python3 /boot/config/plugins/aionui-edu-autodeploy/deployUnraid.py --apply
```

To opt into automatic updates, remove only `/mnt/user/appdata/aionui-edu/deployment/PAUSED` after the first successful installation and proxy checks. Recreate that file to pause. The updater defers while it sees a conversation's Codex process; the account-status process is excluded. This is a conservative process check, not a guarantee against a task starting at the same instant as a switch. Keep automatic updates paused during important or unattended work.

Updates verify the candidate before stopping production, snapshot the stopped app's complete data with its Unix ownership and permissions, retain the old container with restart disabled, then start the new digest. Failed startup restores the previous data and container; failed-release data is retained separately for review. Symlink ownership is copied without following links outside the data tree. A journal enables recovery after an interrupted switch. Schema changes and manual restoration require separate review. Nothing prunes other containers, images or user data.

Image downloads are performed by the **NAS Docker daemon**. The app's SOCKS5 tunnel does not route registry pulls; configure NAS/daemon networking separately if registry downloads also need a proxy.

## Build and start

From this repository's root:

```bash
cp packages/web-host/docker/.env.example packages/web-host/docker/.env
# Edit .env: choose the appdata path and the NAS LAN address to bind.
docker compose --env-file packages/web-host/docker/.env -f packages/web-host/docker/compose.yaml up -d --build
docker compose --env-file packages/web-host/docker/.env -f packages/web-host/docker/compose.yaml logs aionui
```

The initial WebUI username and password are printed in the startup log. Open `http://NAS-LAN-IP:25808` and sign in. The default bind address is loopback; set `AIONUI_BIND_ADDRESS` to the NAS LAN IP for access from another device. The image runs the app as Unraid's usual `PUID=99`, `PGID=100`, with persistent `/data` mounted from `AIONUI_APPDATA`. Keep host deployment code outside that directory.

## Sign in to Codex in the browser

1. Open **Settings → Agents → Codex account** and click **Sign in with ChatGPT**.
2. Open the official verification link, sign in to ChatGPT, and enter the displayed one-time code.
3. Return to Settings. The account status refreshes automatically.

Enable device-code login in ChatGPT's Security settings first. Managed workspaces may require an administrator to enable it. This uses the official [Codex headless authentication flow](https://developers.openai.com/codex/auth/#sign-in-on-a-headless-device); the browser user does not install Codex. WebUI login and ChatGPT login are separate.

Codex credentials live in `/data/codex`; chats, configuration, and other application data also live under `/data`. Keep the volume across container updates. Do not commit or share its contents. The account panel never returns OAuth tokens to the browser. Logging out affects the shared Codex account; it does not erase chat history.

## Codex memories and CLI updates

To opt into Codex's cross-conversation memories on an existing NAS installation:

```bash
docker exec -u 99:100 -e HOME=/data/home aionui-edu /app/node_modules/.bin/codex features enable memories
```

This preserves other Codex configuration and writes the feature flag to the persistent `/data/codex/config.toml`. Newly started Codex sessions read the setting; already-running sessions may need to be reopened when idle. Memory generation happens in the background for eligible chats, so enabling it does not immediately create memories. The memory store under `/data/codex/memories` is shared by this installation's users, like its Codex account. It is separate from ChatGPT memory and other machines' Codex memory stores. See the official [Codex memories documentation](https://learn.chatgpt.com/docs/customization/memories).

**Settings → Agents → Codex CLI updates** reports the version from the installed CLI. **Check for updates** queries the official npm package's `latest` tag from the WebUI server, following the container's proxy routing when enabled. Successful checks are shared for one minute and show their timestamp. Merely opening Settings does not query npm. Failed checks retain the last successful result with an error message.

On Linux/macOS standalone WebUI, signed-in users can click **Update Codex CLI** when a newer stable release is available. The server installs the exact official `@openai/codex` version as the app user under `/data/runtime/codex-cli`, using the same network routing as the app. No NAS administrator privileges or Docker socket are needed. Progress appears in Settings. Before switching, the server checks the executable's version and the app-server methods AionUI requires; a download or validation failure leaves the selected CLI unchanged and allows a retry.

The selected version persists in the data volume across restarts and image updates. New CLI processes use it, including when resuming an existing conversation; running processes continue with their original executable. A conversation's history does not permanently pin a CLI version. The image's pinned CLI remains the fallback when no managed version is selected; replacing the image does not override an existing managed selection. This updates Codex CLI only, not AionUI or AionCore, and is independent of the NAS image deployment pause. The bundled CLI can still be upgraded by updating `@openai/codex` and its lockfile and publishing a tested GHCR image.

**Installed CLI versions** lists managed installations. Cleanup is manual: select eligible old versions, then click **Clean up selected versions**. The two newest validated installations, the selected default, and versions with live processes are protected. The launcher records process leases, and OS process inspection also protects orphaned or directly launched CLI processes. If process inspection is incomplete, cleanup stops. Unrecognised installations and symlink directories are retained. A selected version's usage is checked again on the server before deletion, and update and cleanup jobs cannot overlap. After an older process exits, refresh the list to make that version eligible if it is outside the retained pair.

Cleanup only removes selected, verified updater-owned directories under `/data/runtime/codex-cli/versions`; it does not remove chats, uploaded files, Codex auth, configuration, or memories. The bundled CLI is never a cleanup target. New downloads use a temporary npm cache that is removed with the installation staging files, so archives do not accumulate alongside retained CLI versions. There is no automatic background deletion.

## Route container traffic through SOCKS5

In **Settings → Agents → SOCKS5 network proxy**, enable routing and enter, for example:

```text
socks5://192.168.1.10:1080
socks5://username:password@192.168.1.10:1080
socks5://[2001:db8::10]:1080
```

Use the proxy's reachable IPv4 or IPv6 address, rather than a hostname, to avoid a direct bootstrap DNS lookup. URL-encode special characters in credentials. `127.0.0.1` refers to the AionUI container itself; a proxy on the NAS or another container needs its reachable LAN/container-network address.

Save, then restart the container from Unraid's Docker page, or run:

```bash
docker compose --env-file packages/web-host/docker/.env -f packages/web-host/docker/compose.yaml restart aionui
```

Changes, including disabling the proxy, take effect only after restart. Until then Settings displays the current routing state separately from the saved preference. A blank replacement field keeps previously saved credentials; the browser receives only the redacted endpoint. Alternatively, set `AIONUI_SOCKS5_PROXY` in `.env`; this takes precedence and locks the Settings form. Apply environment changes with `docker compose ... up -d`, since `restart` does not reload `.env`.

The container uses a Linux TUN interface and sing-box to route AionCore, Codex, and tools spawned inside the container through SOCKS5, including DNS over HTTPS through SOCKS5. It requires `/dev/net/tun` and `NET_ADMIN`, as supplied by the Compose file. The app and CLI run without those capabilities. IPv4 and IPv6 firewall rules block direct external egress when routing is enabled; tunnel failure stops the app instead of falling back to a direct connection. SOCKS5 UDP support is needed for UDP workloads; unsupported traffic fails. A UDP relay on a different upstream IP is blocked by the firewall.

Loopback communication and replies to incoming WebUI connections remain available. New direct connections to the attached LAN are blocked too; they do not become a proxy bypass. The user's browser, the NAS host, other containers, Docker image downloads/builds, and remote hosted tools use their own networks. This routing applies to runtime traffic originating inside this container. The Settings form in a native macOS/Windows WebUI only saves the preference; it cannot change the host's routes.

## Verify on the target before regular use

After enabling and restarting, confirm Settings shows routing as active. Compare the container's public egress address with the expected proxy address:

```bash
docker compose --env-file packages/web-host/docker/.env -f packages/web-host/docker/compose.yaml exec aionui curl --fail --max-time 20 https://api.ipify.org
```

During a maintenance window with no active chats, stop the SOCKS5 server and repeat the request. It must fail, without exposing the NAS's direct public address. Restart the proxy and confirm access recovers. Also verify a new Codex chat, DNS resolution, WebUI access, and IPv6 if your network supports it. If startup fails, inspect the container logs and the proxy address, credentials, TUN device, and `NET_ADMIN` capability.

Local checks cover authentication permissions, device-login state handling, proxy persistence/redaction, the generated sing-box schema, deployment recovery and rendered Settings. The GitHub workflow additionally requires the Linux container routing/failure gate before publication. An actual NAS deployment, the provider's SOCKS5 credentials and the user's final ChatGPT sign-in require their own target-host verification.

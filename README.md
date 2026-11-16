# HUGO Harness

The customized Open WebUI application serving the HUGO interface: server grouping and aliases, the HUGO theme and logos, thinking/loading messages, Humanizer, Deep Research, Coding, Automations, and server uptime. Created by Carmelo Schepis.

This repository's root now contains the application previously developed in `carmelo-schepis/open-webui` on branch `hugo-harness`, source commit `3a95dc24f`. See [source provenance](docs/HUGO_SOURCE.md). The earlier React/Fastify workspace is preserved in [legacy/local-harness](legacy/local-harness/README.md).

## TrueNAS installation and updates

TrueNAS SCALE 24.10 or newer with Apps configured is required. Install through the TrueNAS middleware so **hugo-harness appears under Apps**. The installer builds this checkout, registers or updates the Custom App, and starts the frontend/backend and internal Deep Research companion. The research service is accessed through the authenticated app; it has no published host port.

From the NAS shell:

```bash
cd ~
git clone https://github.com/carmelo-schepis/localmodel-harness.git
cd ~/localmodel-harness
sudo python3 scripts/truenas-install.py
```

For an existing checkout and every subsequent update:

```bash
cd ~/localmodel-harness
git pull --ff-only
sudo python3 scripts/truenas-install.py
```

Open `http://<NAS-IP>:3000` and create the first administrator account. This is the Open WebUI based application; the original React app's accounts and `harness.sqlite` are a different format. The installer uses **a `hugo-harness` dataset on the configured Apps pool** for the new application's database, uploads, and persistent secret. It leaves **`/mnt/tank/apps/local-harness`** intact. Existing Open WebUI installations using this installer retain their database on update.

The default storage pool is the pool configured under TrueNAS Apps; the installer creates its own `hugo-harness` dataset. For an existing persistent directory, a specific interface/port, or multiple Ollama servers, use:

```bash
sudo python3 scripts/truenas-install.py --data-dir /mnt/POOL/apps/hugo-webui --bind 100.x.y.z --port 3000 --ollama-url http://SERVER1:11434 --ollama-url http://SERVER2:11434
```

Replace the examples with real addresses. Ollama URLs use the native root without `/v1`. The default is `http://100.84.10.124:11434`; the last server is also used for Deep Research synthesis. Its default model is `qwen3.5:2b`; override with `--research-model`. Keep the app on a trusted LAN or tailnet. The default binding is all NAS interfaces.

Cold startup on NAS storage can take several minutes. The installer allows 15 minutes for readiness by default (`--startup-timeout 60` through `1800` seconds) and disables Python bytecode-cache writes to reduce overlay I/O. It still requires a successful health response and rolls back the previous app configuration if readiness fails. The installer validates and builds before stopping the current Custom App. It backs up the previous configuration and stopped data into a private timestamped directory alongside the new data folder, under `hugo-harness-backups`. The app and research images are tagged by Git revision, with no registry pull for locally built images. The app image must match the checkout revision. Review backups before removing them. To restore an earlier release, stop the app in TrueNAS, restore the matching data backup, and install its matching saved Compose configuration using **Apps → Discover → Custom App → Install via YAML**. Do not run the old shell Compose stack alongside the TrueNAS app on the same port/database.

For a machine with insufficient memory to build the frontend, build it on a development machine from the same commit run `python3 scripts/stamp-frontend.py`, and transfer the resulting `build/` directory (including `.hugo-release.json`) to the NAS. `scripts/build-prebuilt-image.py` uses that verified frontend with the standard backend Dockerfile. Then run the installer with `--image hugo-harness:<revision>`; it rejects images labelled with a different revision. If the NAS already has a standard Open WebUI image, `python3 scripts/build-prebuilt-image.py --base-image <local-image>` can reuse its runtime dependencies. The helper requires exact matches of both dependency manifests and rejects slim images. The full Docker build remains the default path.

## Other Docker hosts

Run `docker compose up --build -d`. The default Compose file builds HUGO from this checkout and includes the internal research service. It binds to loopback by default. Set `HUGO_BIND_IP` and `OLLAMA_BASE_URLS` in your local `.env` when needed. This shell deployment is separate from the TrueNAS Apps installer.

## Development

The root app uses Node 22 and Python 3.12. Follow [the upstream development guide](README.upstream.md) for backend dependency setup. Run the backend on port 8080 (or set `WEBUI_BACKEND_URL`) and start the frontend:

```bash
npm ci --force
npm run dev
```

The upstream lockfile's install command uses `--force`, as does the upstream Dockerfile. Start the dependency-free companion separately:

```bash
OLLAMA_BASE_URL=http://100.84.10.124:11434 node harness-services/deep-research/server.js
```

Vite proxies the companion through `/api/v1/hugo/research`; production uses the authenticated Python router and the internal Compose network. Custom companion URLs remain configurable on the Deep Research page.

## Verification

```bash
python3 -m unittest discover -s tests/installer -v
npm run build
HARNESS_BASE_URL=http://localhost:5173 HARNESS_NO_WEB_SERVER=1 npx playwright test
```

The existing Playwright suite expects a disposable test administrator described in `tests/helpers.ts` and reachable Ollama servers. Never create that fixture account in a production installation. Tests create chats and update user preferences, so run them against a disposable backend. The test credentials are fixtures, not deployment defaults.

Upstream attribution and license terms are retained in [LICENSE](LICENSE), [LICENSE_HISTORY](LICENSE_HISTORY), and [README.upstream.md](README.upstream.md). Imported upstream publishing workflows are archived under `.github/upstream-workflows` and are not run by this repository.

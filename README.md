# local-harness

local-harness is a private, locally hosted research workspace for Hugo. It has a streaming chat, multiple server/model discovery, web search, image attachments, local document ingestion, CSV workbench, Markdown drafts, technical diagnosis cases, and a project library.

## Vercel deployment (no Docker)

The Vercel entry point hosts the React/Vite client and Fastify API together. Docker remains optional for existing local installations. Vercel does not make a local Hugo model server available to a cloud function: configure an authenticated HTTPS gateway to Hugo as `MODEL_SERVER_URL` and its server-side credential as `MODEL_SERVER_TOKEN`. The gateway must permit model discovery, stream responses, and pass upstream cancellation. The current private Tailscale address is not reachable from an ordinary Vercel function unless you separately establish and verify a supported private network path. Do not expose Hugo without authentication.

Configure these server-only Vercel environment variables before deploying:

| Variable | Purpose |
| --- | --- |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | Durable managed SQLite-compatible database. Vercel fails closed if either is missing. |
| `MODEL_SERVER_URL`, `MODEL_SERVER_TOKEN` | Authenticated HTTPS gateway to the Hugo model server. |
| `APP_ACCESS_CODE_HASH`, `APP_SESSION_SECRET` | Required application access-code protection and signed session cookie. Store the SHA-256 hex digest of the access code, not the code itself. |
| `FIRECRAWL_API_KEY` | Optional server-only default for Firecrawl web search. Users may instead enter their own key in Connections & settings. |

Use the Vercel Git integration or install the Vercel CLI to import this repository and build with the committed `vercel.json`. Set environment variables for Preview first, then deploy a Preview and verify model-server reachability from that function before relying on chat. `src/server.ts` exports the Fastify app for Vercel's Node runtime; `npm run start` remains available for local builds. Production deployment and managed-service provisioning are separate operational steps.

Function request and response bodies are capped at 4 MiB in the app to stay below Vercel's 4.5 MB platform limit. Until the scoped direct-upload flow is implemented, Vercel attachment uploads are limited to 2.8 MB (image bytes expand when encoded into chat JSON). Existing browser-local image and fork records are origin-local and will not transfer from a Tailscale-hosted origin to the Vercel origin.

### Optional SQLite to Turso import

Do not run this against production automatically or point it at a database that already contains data. Make a SQLite backup, create an empty Turso database, and run the import explicitly:

```bash
SOURCE_DB=/path/to/backup.sqlite TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... npm run migrate:turso
```

The command makes a consistent temporary SQLite snapshot, refuses a nonempty target, imports in batches, checks row counts and message ordering, and leaves the original SQLite file unchanged. Keep the SQLite backup until the imported deployment has been reviewed. Rollback by switching the deployment back to its previous local/hosted database configuration; the import does not modify SQLite.

## Start with Docker

Install Docker Compose, clone this repository, and run:

```bash
./scripts/start.sh
```

Open `http://localhost:3000` and paste your Hugo endpoint, for example `http://100.84.10.124:11434/v1`. The helper generates a private SearXNG secret on first use. Application and project files live in the `app-data` Docker volume. Back it up with `docker compose down` followed by a volume backup; the app does not yet include a one-click restore screen.

The host port defaults to `127.0.0.1`. To expose the app only on this machine's Tailscale interface, set `APP_BIND_IP` in the ignored `.env` file to its Tailscale IPv4 address and restart Compose; the link is `http://<APP_BIND_IP>:3000`. Tailnet peers allowed by your Tailscale ACL can access this single-user app, which has no separate login. Remove `APP_BIND_IP` or set it to `127.0.0.1` to return to loopback-only access. The application container must be able to reach the Hugo host. Tailnet DNS/IP routes available to the host may not be available inside Docker; verify container connectivity if endpoint testing fails. Do not publish the app or a Hugo server directly to the public internet.

## Develop

Requirements: Node 22 LTS and Docker Compose (the development search endpoint is the Compose SearXNG service).

```bash
npm ci
docker compose up -d searxng
npm run dev
```

Vite serves the UI on port 5173 and proxies `/api` to the Fastify server on port 3000. `npm run build` type-checks and builds the browser app and server. `npm start` runs the built server.

## Capabilities and current boundaries

Models are discovered from each connected Hugo server; compatible models may stream text and accept a vision image. Research and diagnosis requests using a discovered tool-capable model can invoke the bundled `search_web` tool through the official MCP TypeScript SDK. Manual and model-run web searches use Firecrawl when a key is available — users can connect their own key in Connections & settings, where the key is tested with one small bounded search and then held **only in the current tab's memory** (it is cleared on refresh, disconnect, or sign-out, and is never written to storage, the database, logs, or chat history); a tested tab key takes precedence for that tab's requests, and `FIRECRAWL_API_KEY` remains the optional server default. Without any Firecrawl key, searches fall back to the private SearXNG service. Connecting a Firecrawl key verifies search access only; page crawling, PDF reading, and site extraction are not included in that connection. Files are limited to 10 MiB. Text, logs, CSV/JSON, PDF and DOCX are ingested locally. The CSV workbench can sort, deduplicate and export; essay drafts and diagnosis cases are saved per project.

This initial release does not yet provide custom stdio or Streamable HTTP MCP connections, safe full-page fetching, semantic embeddings/retrieval, persistent evidence-linked citations, citation verification, full essay generation/revision, or structured log parsing and deterministic data-quality reports. Search results are snippets; visit the source to verify its full content. Vision requests can take tens of seconds depending on the server.

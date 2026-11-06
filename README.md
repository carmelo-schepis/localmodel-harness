# local-harness

local-harness is a private, locally hosted research workspace for Hugo. It has a streaming chat, multiple server/model discovery, web search, image attachments, local document ingestion, CSV workbench, Markdown drafts, technical diagnosis cases, and a project library.

## Start with Docker

Install Docker Compose, clone this repository, and run:

```bash
./scripts/start.sh
```

Open `http://localhost:3000` and paste your Hugo endpoint, for example `http://100.126.194.51:11434/v1`. The helper generates a private SearXNG secret on first use. Application and project files live in the `app-data` Docker volume. Back it up with `docker compose down` followed by a volume backup; the app does not yet include a one-click restore screen.

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

Models are discovered from each connected Hugo server; compatible models may stream text and accept a vision image. Research and diagnosis requests using a discovered tool-capable model can invoke the bundled `search_web` tool through the official MCP TypeScript SDK, using the private SearXNG service. Files are limited to 10 MiB. Text, logs, CSV/JSON, PDF and DOCX are ingested locally. The CSV workbench can sort, deduplicate and export; essay drafts and diagnosis cases are saved per project.

This initial release does not yet provide custom stdio or Streamable HTTP MCP connections, safe full-page fetching, semantic embeddings/retrieval, persistent evidence-linked citations, citation verification, full essay generation/revision, or structured log parsing and deterministic data-quality reports. Search results are snippets; visit the source to verify its full content. Vision requests can take tens of seconds depending on the server.

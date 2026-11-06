# Verification record

This record separates checks against the application from earlier checks against the Ollama server itself. The required full product acceptance suite is not complete; see the known gaps below.

## Environment

- Date: 6 November 2026
- Node.js: 22 LTS (supported by this project's declared tooling)
- App: React/Vite client, Fastify server, SQLite local database
- Live Ollama endpoint: `http://100.126.194.51:11434/v1`
- The Ollama endpoint evidence in `ENDPOINT_VERIFICATION.md` was gathered before app implementation and is retained as such.

## Commands and results

- `npm run typecheck` — passed.
- `npm run lint` — passed with two React effect dependency warnings.
- `npm test` — passed; three URL normalization and rejection tests.
- `npm run build` — passed for client and server.
- `npm audit --omit=dev --audit-level=high` — passed with zero production dependency vulnerabilities after upgrading `@fastify/static` to 10.1.10. The complete development dependency audit still reports findings and has not been remediated.
- `docker compose config --quiet` — passed with a generated local `SEARXNG_SECRET`; the supported `scripts/start.sh` creates the ignored `.env` file on first use.
- `./scripts/start.sh` — the corrected pinned SearXNG image and production app built and started successfully. The app data volume is writable by the unprivileged app user. The only published port is `127.0.0.1:3000`.
- The running development app returned HTTP 200 from health, project, and endpoint routes. Connecting the live endpoint discovered eight models and their advertised capabilities.
- Browser workflow: selected `qwen3:1.7b`, streamed “browser connection successful” from the live Ollama server through the app UI, and saw the result in the project conversation.
- Deployment container route: from inside the running app container, `GET http://100.126.194.51:11434/api/tags` returned HTTP 200 with eight models. Registering the endpoint via the app's HTTP route discovered all eight and their capability metadata.
- Deployment chat: streamed `container connection successful` through the app API using `qwen3:1.7b` and the container-to-Ollama route; the stream delivered its completion event.
- Bundled search network path: from inside the app container, `http://searxng:8080/search?q=ollama&format=json` returned HTTP 200 with JSON. The app search route returned results. This verifies search connectivity only; it does not make results a cited or source-inspected research workflow.
- `docs/ENDPOINT_VERIFICATION.md` records pre-implementation live probes for text, a tool-call/result exchange, image input, and embeddings. These were direct host-to-Ollama calls, not proof that those complete product workflows exist in this app.

## Not verified or not implemented

- Search currently returns provider snippets and is not a cited research workflow.
- Chat currently reports an error if Ollama returns a tool call. There is no MCP SDK tool execution loop, generic MCP connections UI, or bundled MCP research server yet.
- Image upload plumbing exists, but a live image request through the app UI has not been accepted. PDF extraction is text-based; scanned-page vision routing is absent.
- There is no semantic retrieval, persistent source versioning/citation resolution, or claim-evidence validation.
- CSV actions are minimal and not the required deterministic preview/apply/reversal workflow. Essay generation/revision/version diffs, structured log analysis, data-quality diagnostics, project export/restore, and the specified Playwright acceptance suite remain outstanding.
- Two independently controlled Ollama servers, cancellation/reconnect, hostile URL redirects, SSRF defenses, and responsive/accessibility acceptance have not been fully verified.

Do not interpret the successful build, unit checks, or one live streaming chat as completion of the product's required workflows.

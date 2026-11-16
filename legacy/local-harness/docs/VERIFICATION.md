# Verification record

This record separates checks against the application from live Hugo endpoint probes. The chat, image, chat navigation, fork, theme, and responsive workflows in this implementation scope have been exercised below; unrelated product gaps remain listed separately.

## Environment

- Date: 7 November 2026
- Node.js: 22 LTS (supported by this project's declared tooling)
- App: React/Vite client, Fastify server, SQLite local database
- Live Hugo endpoint: `http://hugo.example:11434/v1`
- The Hugo endpoint evidence in `ENDPOINT_VERIFICATION.md` was gathered before app implementation and is retained as such.

## Commands and results

- `npm run typecheck` — passed.
- `npm run lint` — passed without lint warnings after marking the one-time bootstrap/project-identity effects intentional.
- `npm test` — passed; 10 unit tests.
- `npm run build` — passed for client and server.
- `npm run test:e2e` — passed; all 21 Playwright tests, including mocked UI workflows and the isolated app/model-server integration fixture. The integration fixture decoded the image base64 received by the model server and compared it byte-for-byte with the original PNG.
- The browser tests cover image picker and drop, vision model selection and incompatible-model blocking, attachment position and reload, image reuse, missing local pixels, recoverable Stop/retry, interrupted response replay, project isolation, forks, saved chats, dark/light themes, and desktop/phone layout. Regression tests delay IndexedDB writes and image comparison, switch chats during preparation, and check that drafts, image pixels, and transcripts remain attached to the original conversation. Repeated identical image turns are reloaded while the browser clock is behind the server to check stable attachment identity.
- Visual check against the supplied reference: the deployed page at 1280×800 computed to 16px base/work text, 14px navigation, 15px search heading and composer text, and a 67.84px workspace hero. The theme computed to black `#000`, white text `#fff`, and white buttons with black text. At 390×844 the document stayed 390px wide and the header title stayed on one line. The browser reported no console errors or failed network requests.
- `npm audit --omit=dev --audit-level=high` — passed with zero production dependency vulnerabilities after upgrading `@fastify/static` to 10.1.10. The complete development dependency audit still reports findings and has not been remediated.
- `docker compose config --quiet` — passed with a generated local `SEARXNG_SECRET`; the supported `scripts/start.sh` creates the ignored `.env` file on first use.
- `./scripts/start.sh` — the corrected pinned SearXNG image and production app built and started successfully. The app data volume is writable by the unprivileged app user. The only published port is `127.0.0.1:3000`.
- The running development app returned HTTP 200 from health, project, and endpoint routes. Connecting the live endpoint discovered eight models and their advertised capabilities.
- Browser workflow: selected `qwen3:1.7b`, streamed “browser connection successful” from the live Hugo server through the app UI, and saw the result in the project conversation.
- Deployment container route: from inside the running app container, `GET http://hugo.example:11434/api/tags` returned HTTP 200 with eight models. Registering the endpoint via the app's HTTP route discovered all eight and their capability metadata.
- Deployment chat: streamed `container connection successful` through the app API using `qwen3:1.7b` and the container-to-Hugo route; the stream delivered its completion event.
- Bundled search network path: from inside the app container, `http://searxng:8080/search?q=ollama&format=json` returned HTTP 200 with JSON. The app search route returned results. This verifies search connectivity only; it does not make results a cited or source-inspected research workflow.
- Live MCP round trip: the app supplied the MCP-discovered `research__search_web` schema to `qwen3:1.7b`; Hugo requested it, the official MCP SDK client dispatched it to the bundled search server, SearXNG returned results, and the model produced a follow-up answer citing returned result URLs. The app emitted tool running/completed activity events; the browser also completed a tool-directed research prompt. This was one bounded successful case, not coverage of arbitrary MCP servers or failure cases.
- `docs/ENDPOINT_VERIFICATION.md` records pre-implementation live probes for text, a tool-call/result exchange, image input, and embeddings. These were direct host-to-Hugo calls, not proof that those complete product workflows exist in this app.
- Isolated live image acceptance: started the production server from the current build with `DATA_DIR=/tmp/local-harness-final-verification` and `PORT=3198`, registered the selected Hugo endpoint through `/api/endpoints`, rediscovered `gemma3:4b` as `completion` + `vision`, created a temporary project, and sent the deterministic 400-byte `e2e/fixtures/vision-shapes.png` through the app's `/api/chat` route. The response identified red on the left, blue on the right, and a centered yellow circle. The stream completed in 57.67 seconds. The isolated server was stopped afterward; temporary data stayed under `/tmp`.

## Not verified or not implemented

- Search currently returns provider snippets and is not a cited research workflow.
- The bundled MCP path supports `search_web` only. Custom stdio/Streamable HTTP server configuration, `fetch_page`, hardened public URL fetching, durable tool-activity history, and approval policies are not implemented.
- PDF extraction is text-based; scanned-page vision routing is absent.
- There is no semantic retrieval, persistent source versioning/citation resolution, or claim-evidence validation.
- CSV actions are minimal and not the required deterministic preview/apply/reversal workflow. Essay generation/revision/version diffs, structured log analysis, data-quality diagnostics, and project export/restore remain outstanding.
- Two independently controlled Hugo servers, cancellation/reconnect across broader network failure cases, hostile URL redirects, SSRF defenses, and full accessibility acceptance have not been fully verified.

Do not interpret the successful build, unit checks, or one live streaming chat as completion of the product's required workflows.

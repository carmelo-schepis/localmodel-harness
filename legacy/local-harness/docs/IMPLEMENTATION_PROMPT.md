# Implementation prompt: Hugo Research Harness

Build a local-first, single-user research application in this repository. Make Hugo models useful for web research, image and document understanding, data sorting, essay writing, and evidence-based troubleshooting. Deliver working workflows, not demonstration screens.

## 1. Confirmed context and assumptions

Read `DESIGN.md`, `docs/endpoint-check.json`, and any repository instructions before coding.

Confirmed during planning on 6 November 2026:
- Before planning, this repository contained only `LICENSE` and an initial Git commit. There is no existing application, framework, API, database, or component system to extend.
- The attached design has been copied unchanged to `DESIGN.md`.
- `http://hugo.example:11434/v1/models` returned HTTP 200 and eight installed models. Native version discovery returned Hugo `0.33.0`.
- A real `/v1/chat/completions` request using `gemma3:1b` returned “connection successful”; that small request took about 19 seconds including any loading.
- A bounded retry using `qwen3:1.7b` produced a valid structured `echo_probe` tool call in 8.37 seconds and accepted the matching tool result in a follow-up request. This verifies model tool-call/result handling, not an implemented MCP integration.
- `embeddinggemma:latest` produced one 768-dimensional embedding in 2.92 seconds.
- A generated red-square image sent to `gemma3:4b` returned “Red” in 44.44 seconds on the bounded retry, verifying real image input rather than capability metadata alone.
- The endpoint advertises vision for `gemma3:4b` and `gemma3:12b`; tools for `qwen3:1.7b`, `qwen3:8b`, and `qwen2.5-coder:7b`; embeddings for `embeddinggemma:latest`. `gemma3:1b` and `dolphin3:8b` advertise text completion only.
- Advertised capabilities are not proof of successful inference. Read the evidence file for actual probe results; initial tool and vision probes hit their 50-second client timeouts. Later smaller probes with longer timeout budgets passed. These different requests are not a controlled performance comparison.
- No second endpoint was supplied. Multi-server verification must use independent controlled test servers plus any additional real endpoint the user later supplies.

Confirmed diagnosis scope: technical problems, logs, and data quality, as selected by the user.

Assumptions: ship a locally hosted browser application first, without accounts or cloud dependencies for inference. Docker/Podman installation and network access are deployment prerequisites; once installed, entering a Hugo URL is the only required application configuration.

Do not install or change Hugo, pull/delete models, alter its configuration, or modify other projects.

## 2. Product goal and expected behaviour

The first-run screen asks for one endpoint URL. The user pastes the supplied URL, presses Connect, sees discovered models and usable capability badges, and can start work without entering model names, API keys, or MCP JSON.

Settings supports multiple independently named Hugo servers. The model picker shows both model and server. The user can keep automatic task routing or pin a model and endpoint.

Organise work into persistent projects containing conversations, sources, uploaded documents, datasets, drafts, and diagnostic cases. Provide four workspaces: Research, Data, Writing, and Diagnose. They share the project's evidence library and conversation history.

Distinguish these required behaviours from optional enhancements:
- Required: endpoint-only onboarding, multiple endpoints, streamed chat, vision, MCP internet access, cited research, document retrieval, deterministic data operations, essay drafting/editing, diagnostic case building, persistence, export, cancellation, and tested failure states.
- Later improvements: model comparison, conversation branches, richer charting, watch folders, scheduled research, optional browser automation, desktop packaging, voice, and additional authenticated integrations.
- Excluded: training models, cloud inference fallback, distributed model weight sharding, autonomous shell execution, multi-user collaboration, and a general plugin marketplace.

## 3. Architecture and dependencies

Use React, TypeScript, and Vite for the client; a Node.js TypeScript server using Fastify; SQLite plus FTS5 for persistence and keyword search; and local disk storage for attachments. A single server process should serve the production client and own background jobs.

Choose mutually compatible stable versions, a supported Node LTS, and a lockfile. Do not hard-code package versions based on memory.

Use the official MCP TypeScript SDK. At planning time the official documentation identifies v2, with separate client/server packages, as the stable line. Check its current imports and interoperability guidance instead of copying outdated v1 snippets. Support both stdio and Streamable HTTP using the SDK, including compatible older servers.

Keep modules for UI, Hugo access, model routing, task execution, MCP, ingestion, retrieval, and persistence. Avoid a large agent framework, Redis, Kubernetes, or a separate vector database for this first release. Begin with bounded project-scoped cosine search alongside FTS5; measure its ceiling before introducing another storage service.

Use server-side HTTP requests rather than browser-to-Hugo calls. This avoids mixed-content/CORS requirements and keeps MCP processes and secrets off the client. Never ask the user to make Hugo publicly accessible or change OLLAMA_ORIGINS.

Provide a turnkey Compose deployment containing the application and a private SearXNG service. Enable SearXNG JSON output explicitly, pin its image, create required secrets automatically, persist application data, and expose only the application port on host loopback. Bind the server to the container interface internally while publishing only `127.0.0.1` on the host. A development start command may reuse this same search service.

SearXNG is the necessary search dependency for the keyless default. It can still encounter upstream blocking or empty results; report that honestly and retain supplied-URL fetching and offline document research. Optional paid search and authenticated MCP services may require their own credentials and must not become onboarding requirements.

## 4. Proposed file responsibilities

These are new paths proposed for an inspected, otherwise empty repository; adapt naming if stronger repository evidence appears.

- `src/client/app/`: routing, project shell, navigation, onboarding.
- `src/client/components/` and `src/client/styles/tokens.css`: reusable accessible controls and design tokens.
- `src/client/features/{chat,research,data,writing,diagnose,settings}/`: workspace UI and local interaction state.
- `src/server/ollama/`: URL handling, discovery, capability metadata, native requests, compatibility requests, stream parsing.
- `src/server/runs/`: orchestration, endpoint queues, cancellation, checkpoints, event log.
- `src/server/mcp/`: SDK client connections, server configuration, permissions, tool dispatch.
- `src/server/research-mcp/`: bundled research server exposing search and public-page fetching.
- `src/server/{ingestion,retrieval,data,writing,diagnostics}/`: bounded domain services.
- `src/server/storage/` and `src/server/routes/`: database, attachment handling, internal application routes.
- `src/shared/`: validated application types and stream event contracts.
- `tests/{unit,integration,e2e,fixtures}/`: deterministic fixtures and meaningful workflow tests.
- `compose.yaml`, `Dockerfile`, `config/searxng/`, `README.md`, `docs/VERIFICATION.md`: installation, operation, and evidence.

Preserve `LICENSE`, `DESIGN.md`, and planning evidence. Ignore generated databases, uploads, secrets, build files, and local logs in Git.

## 5. Hugo connections and model routing

Implement this before higher-level workflows:

1. Accept an origin or an OpenAI-style base ending in `/v1`, with optional trailing slash. Validate HTTP(S), reject embedded credentials/query/fragment ambiguity, preserve meaningful reverse-proxy prefixes, and never produce `/v1/v1` or `/v1/api/chat`.
2. Keep native and compatibility bases separate. For the supplied URL they are `http://hugo.example:11434` and `http://hugo.example:11434/v1`.
3. Discover native version, installed models, per-model capabilities, and running models using Hugo's documented endpoints. Use native chat and embeddings for Hugo-specific features; verify OpenAI-compatible model discovery and text chat as supported compatibility paths.
4. If native metadata is unavailable but `/v1` works, retain basic chat in a clearly labelled compatibility mode. Unknown capabilities must remain unknown. Advanced base-path overrides belong in Settings, not first-run setup.
5. Key model identity by endpoint ID plus model name; retain digests and capability provenance. Refresh metadata in the background with timeouts and bounded concurrency.
6. Select routes from discovered capabilities and observed health. Prefer a small responsive model for fast tasks, a suitable tool model for research, a vision model for images, and an embedding model for retrieval. Offer quality/latency preferences rather than assuming the biggest model is best.
7. Treat Qwen and Gemma as initial examples, never hard-coded prerequisites. A candidate larger model is not a measured quality recommendation.
8. For image-plus-tools tasks, use a single compatible model when available. Otherwise run vision extraction first, retain image provenance, and provide the extracted observations to the tool-capable coordinator. Distinguish source pixels, extracted text, and model inference.
9. Discover every installed model but load weights only when needed. Do not preload all models, auto-download missing models, or unload models belonging to other clients.
10. Default to one active inference request per endpoint, including embedding jobs, with a queue and an adjustable limit. Independent servers may work concurrently. Endpoint aliases of the same normalised base must not create duplicate queues.
11. Separate connection timeout, cold-load/first-token timeout, inactivity timeout, and total job budget. Make them configurable. Do not call a slow inference request an unreachable server when discovery still works.
12. Respect advertised context limits and conservative runtime allocation. Track context usage, reserve space for output/tools/images, retrieve bounded evidence, and compact older conversation turns with visible summaries. Do not promise that a model's theoretical context fits server memory.
13. Fail over only to an allowed endpoint with compatible capabilities. Keep project routing permissions and model provenance. Preserve partial output; never concatenate a second model's answer into an interrupted answer or replay side effects silently.

Use profiles such as Fast, Balanced, and Thorough to set explicit output, evidence, tool-call, and time budgets. Record actual timings and token usage when returned; do not invent GPU telemetry or cloud pricing.

## 6. MCP and internet research

Ship a bundled, preconfigured stdio research MCP server with `search_web` backed by the private SearXNG instance and `fetch_page` for bounded public HTTP(S) content. No manual MCP configuration should be required for default research.

Add an advanced Connections screen for custom stdio and Streamable HTTP servers: name, transport, URL or executable/argument array, optional authentication, status, discovered tools/resources/prompts, and per-project enablement. Use SDK-supported version negotiation and auth flows. An authentication failure must leave the rest of the app usable.

The coordinator must perform the real model → validated tool call → MCP execution → tool result → model response loop:
- Namespace tool names and validate tool arguments against their schemas.
- Enforce per-call timeouts, total step/time/result-size budgets, cancellation, and a repeated-call detector.
- Handle multiple calls, malformed arguments, unknown tools, denied actions, and MCP error results.
- Record actual calls, arguments with secrets redacted, durations, and outcomes in the activity panel.
- Run only explicitly trusted stdio executables with argument arrays; do not build shell commands from model output.
- Treat custom local MCP executables as trusted code: application tool policies do not sandbox a subprocess. Do not automatically install or launch arbitrary discovered packages.
- Permit approved research reads under a project-level policy. Require approval for external writes or broader file access from custom tools. Do not trust a server's read-only annotation as the only permission boundary.
- Treat web pages, documents, and tool results as untrusted evidence, not application instructions. Sanitise rendered HTML/Markdown.
- Public-page fetching must block loopback/private/link-local/metadata and tailnet addresses, including IPv6, DNS changes, and redirects. Explicitly configured Hugo/MCP addresses use a separate allowlisted connection policy, so the supplied tailnet server remains reachable.

Research mode should produce a short research plan, retrieve several relevant sources, deduplicate them, inspect full accessible content, and assemble a cited synthesis. Support follow-up investigation, source pinning/exclusion, date/domain filters, and comparison of contradictory claims.

Each saved source needs a stable ID, title, canonical/final URL or attachment identity, retrieval time, available author/publication date, content hash, and excerpt/page/section locations. Preserve source versions. Label search snippets separately from inspected pages.

Citations must resolve to stored evidence; clicking one opens the relevant excerpt. Never fabricate titles, URLs, quotations, page numbers, or bibliographic fields. Validate reference existence programmatically, but do not claim this alone proves that the cited text supports the claim. Missing evidence should be visible.

## 7. Vision, documents, and retrieval

Support drag-and-drop and pasted PNG/JPEG/WebP images; PDF, TXT, Markdown, CSV, JSON, and DOCX uploads. Show previews, limits, ingestion progress, and per-file errors.

Extract document text locally. Preserve PDF page boundaries, document headings, dataset row identifiers, and file hashes. Render scanned PDF pages locally and route selected/batched pages through an available vision model, with cancellable page limits. Label visual transcription as inferred and expose the original page for checking.

Cover screenshots, charts, diagrams, document photos, and image comparisons. Do not equate a model's visual reading with verified OCR or exact chart measurements.

Chunk by document structure, keep chunks inside the embedding model's limits, and index asynchronously. Store embedding model identity/digest, dimensions, and chunking version. Use the same compatible embedding space for indexing and querying; reindex explicitly when it changes. Continue with FTS5 when embeddings are unavailable.

Scope retrieval to the current project by default. Do not put entire large files into a prompt or leak another project's sources. Make Online/Offline mode prominent; offline mode disables internet tools while retaining configured Hugo inference.

## 8. Research, data, writing, and diagnosis workflows

### Research

Provide project brief/questions, a source library, evidence notes, an editable synthesis, and an evidence table linking claims to sources and disagreements. Save retrieved content so notes remain useful when a page later disappears. Export reports and references.

### Data sorting and analysis

Import CSV/JSON, preview rows and inferred types, and let the user correct types. Support stable sorting, filtering, grouping, counts, deduplication, missing-value summaries, and proposed label/classification columns.

Execute deterministic operations through validated structured operations and parameterised queries, not free-form model-generated code or unrestricted SQL. Compute counts/statistics in code. Use the model for interpretation and classification, keeping row IDs and failed/unclassified rows visible.

Show a transformation preview and before/after counts before applying it. Preserve original files and a reversible transformation history. Export CSV/JSON without changing the source. Escape spreadsheet formulas in safe CSV exports, with a clearly documented raw export alternative.

Keep larger tables paginated or virtualised and perform heavy work outside the UI thread. Set and publish initial file/row limits. Cover mixed types, malformed records, duplicate headers, Unicode, empty files, and partial batch failures.

### Essay writing

Collect topic, audience, thesis, approximate length, tone, and citation style. Support outline → section drafting → full draft → revision. Use project sources and pinned evidence.

Provide an editable Markdown document with autosave, word count, version history, and proposed-change diffs; generated edits must not overwrite manual work. Keep citations bound to evidence throughout revisions. Flag unsupported claims and missing reference metadata.

Export Markdown, DOCX, and a reference list; support print-to-PDF. Start with two deterministic citation styles, such as APA and Harvard, using real available metadata. Do not invent a DOI or publish a section merely because it contains a citation marker.

### Diagnose

Create cases containing symptoms, logs, screenshots, environment/context, timeline, observed facts, hypotheses, supporting/conflicting evidence, and suggested next tests. Rank hypotheses qualitatively and distinguish observations from conclusions.

Focus the workspace on technical problems, logs, and data quality:
- Technical problems: software failures, configuration errors, service connectivity, and performance symptoms, with reproducible checks and evidence-backed root-cause hypotheses.
- Logs: ingest plain-text and structured JSON/NDJSON logs, preserve timestamps and original line/record references, filter by time/severity/component, group repeated errors, and build incident timelines. Keep timestamp/timezone assumptions visible and redact secrets before sending evidence to models or external tools.
- Data quality: reuse the Data workspace's deterministic checks for missing values, duplicates, type/schema mismatches, invalid ranges, and inconsistent formats. Link findings to exact affected rows and columns, show calculated counts, and distinguish rule violations from model-suggested anomalies.

Let the user add new results and revise the case, retaining the history and an exportable report. Suggested fixes must include validation steps; any dataset changes use the existing reversible preview/apply flow. Do not automatically run remediation or shell commands. Do not present model guesses as calibrated probabilities. Medical diagnosis is outside the requested scope.

## 9. UI and design requirements

Translate the supplied marketing-oriented design into a productive application, not a marketing landing page.

Use canvas `#010102`; surfaces `#0f1011`, `#141516`, `#18191a`, `#191a1b`; hairlines `#23252a`; main text `#f7f8f8`; secondary text `#d0d6e0`/`#8a8f98`; and scarce lavender `#5e6ad2`. Use the documented hover/focus values.

Use system sans or locally supplied Inter/Geist, 14–16px working text, 12–13px metadata, and 22–28px workspace headings. Keep large display typography for onboarding only. Follow the 4px spacing scale, 8px controls, 12px panels, and restrained borders. No decorative gradients, oversized rounded CTAs, proprietary font downloads, or unrelated accent palette.

Desktop: project/navigation sidebar, main conversation or working document, and a resizable evidence/activity inspector. The header shows workspace, endpoint/model selection, connectivity, and online/offline state. Include a persistent composer with attachments, mode, send, and stop.

Navigation: Research, Data, Writing, Diagnose, Library, and Settings. Advanced endpoint/MCP configuration stays in Settings. Source details, tool activity, and run history live in the inspector.

At tablet widths collapse the inspector; on mobile turn the sidebar into a drawer and the inspector into tabs/sheets. Keep controls keyboard-accessible, labelled, focus-visible, and usable at 44px touch targets. Do not encode status only through colour. Add a command palette and project/history search using the same actions as visible controls.

Every asynchronous area needs idle/loading/empty/success/error/cancelled states. Show meaningful stages such as Connecting, Loading model, Reading sources, Waiting for approval, and Generating, with elapsed time where useful. Never show fake percentage progress.

## 10. Persistence, API boundaries, and operational behaviour

There is no existing API/database to preserve. New internal application routes are necessary for this greenfield request; keep them small and validated. Do not modify upstream Hugo or MCP contracts, authentication behaviour, credentials, or model definitions.

Store endpoints, model cache, projects, conversations/messages, runs/events, source versions/chunks, embeddings, attachment references, datasets/transformations, document versions, diagnostic cases, and MCP settings. Define stable IDs, timestamps, defaults, foreign keys, and additive versioned migrations.

Store files outside public assets; prevent path traversal and bound uploads/extraction. Keep secrets server-side with restricted permissions, redacted logs, and no client bundles or default exports containing credentials. Project export/backup must include usable evidence and attachments while excluding secrets by default. Test restore.

Persist run checkpoints and use event IDs for reconnect. Refreshing the browser should reconnect to an existing run rather than duplicate it. On server restart, mark interrupted stages accurately and offer an explicit resumable checkpoint; do not blindly replay tools with unknown outcomes.

Default to loopback access with host/origin checks. Remote access/authentication is a separate deployment decision. Test the supplied tailnet endpoint from inside the actual deployed container, not only the host.

## 11. Implementation sequence

Deliver these milestones in order, with executable checks after each:

1. Scaffold the client/server, shared validation, SQLite migrations, design tokens, shell, and reproducible start/build/test commands.
2. Deliver endpoint-only onboarding, native/compatibility discovery, multiple endpoints, capability-aware model selection, streaming chat, persistence, and cancellation.
3. Add image attachments, real vision requests, endpoint queues, context budgets, routing, and capability failures.
4. Add the bundled search deployment, research MCP server, generic MCP client settings, real tool loops, permissions, activity history, and bounded execution.
5. Add source persistence, document ingestion, keyword/semantic retrieval, cited research reports, and offline workflows.
6. Deliver the data, writing, and diagnostic workspaces with reversible changes and exports.
7. Complete responsive/accessibility work, checkpoint recovery, backup/restore, regression tests, deployment documentation, and real endpoint acceptance evidence.

Do not mark later required milestones complete because the chat shell works. Finish the working single-user product before optional roadmap features.

## 12. Tests and Playwright acceptance workflow

Use unit/integration tests for URL normalisation, endpoint-scoped model identity, capability routing, fragmented NDJSON/SSE streams, tool-loop replay and limits, cancellation, reconnect deduplication, source/citation resolution, project isolation, embedding incompatibility, deterministic data transforms, draft conflicts, and migrations.

Use controlled independent mock Hugo servers and real SDK-based fixture MCP servers in normal CI. Cover one endpoint offline, duplicate model names across endpoints, malformed tool arguments, MCP disconnect/error, no vision/tool model, embedding failure, cold loads, partial output, malicious source instructions, blocked fetch redirects, and oversized files.

Use Playwright for actual workflows:
1. Start with fresh local data, open onboarding, paste an endpoint, connect, and verify discovered model choices. Refresh and confirm persistence.
2. Add a second independent test endpoint, select identically named models on each, make one fail, and verify routing, clear provenance, and preserved output.
3. Stream a response, stop generation, navigate away/back, reconnect, and confirm no duplicated runs/messages.
4. Upload a known image and a scanned-page fixture, inspect their vision route and output, then remove vision availability and verify the supported fallback/error state.
5. Run research through the bundled MCP connection, open evidence citations, follow up, test a failed/empty search, and switch offline.
6. Import a fixture CSV, preview/apply sorting and deduplication, verify exact counts, undo, export, and confirm the original remains intact.
7. Generate an evidence-backed outline and essay, manually edit, preview a proposed revision, restore a version, refresh, and inspect exported references/DOCX.
8. Create a technical diagnostic case from logs and a screenshot, filter/group log records and inspect source-line references, add new test evidence, and verify its updated report/history. Run a data-quality fixture with known duplicates, missing values, and invalid types; assert exact counts and affected row/column references, then verify a proposed correction follows the reversible preview/apply flow.
9. Verify project isolation, backup/restore, keyboard navigation, and desktop/tablet/mobile layouts.
10. Capture relevant screenshots/traces, console errors, and unexpected failed requests. Expected deliberately induced failures must be asserted, not hidden.

Keep opt-in live tests separate from CI. Retest `http://hugo.example:11434/v1` with small text, structured tool-call/result round-trip, known image, embeddings, streaming/cancellation, and the actual container network path. Use measured cold-load budgets and record failures honestly. If a second real endpoint is unavailable, state that multi-endpoint behaviour was fixture-verified rather than claiming a live two-server test.

Regression checks must rerun onboarding, plain chat, model/endpoint switching, source links, manual editing, original data preservation, navigation, and persistence whenever their shared components change.

## 13. Acceptance criteria and completion

The required release is complete only when:
- A clean installation requires only a Hugo endpoint in the app, discovers models automatically, and supports multiple saved endpoints.
- Chat, vision, actual MCP tool execution, cited web/document research, data transformations, essay revision, and diagnostic cases each work end to end.
- The default web-search path requires no paid API key or manual MCP setup; failure never masquerades as successful browsing.
- Model routes respect capabilities; disconnected/missing/slow models yield useful states rather than fabricated success.
- Every citation resolves to available stored evidence; deterministic row operations match fixture results.
- User edits, source originals, project boundaries, and interrupted work are preserved.
- The design matches `DESIGN.md`, with usable responsive layouts and keyboard controls.
- Type checking, linting, build, targeted tests, integration tests, and Playwright workflows pass with no new unexpected runtime/console/network errors.
- `docs/VERIFICATION.md` records commands, environment, real versus mocked checks, timeouts, and remaining limitations. Temporary debugging code and credentials are removed.
- README explains install/start/update/backup/restore, tailnet reachability, capability requirements, search prerequisites, and supported limits.

You may decide component names, helper structure, compatible dependencies, concrete schemas, test selectors, and small implementation details. Adjust assumptions when evidence requires it and document why. Do not change external APIs, server authentication, destructive data handling, deployment exposure, or the core architecture without explicitly identifying the need.

## 14. Optional roadmap after the required release

Prioritise saved workflow templates, side-by-side model evaluation, branchable conversations, source freshness checks, richer spreadsheet/charts support, and reusable opt-in project memory. Later consider watch folders, scheduled research, sandboxed browser automation, desktop packaging, and specialist integrations. Do not enable these by default or let them delay the required workflows.

## Primary references checked during planning

- [Hugo OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility)
- [Hugo model metadata](https://docs.ollama.com/api-reference/show-model-details)
- [Hugo tool calling](https://docs.ollama.com/capabilities/tool-calling)
- [Hugo vision](https://docs.ollama.com/capabilities/vision)
- [Hugo embeddings](https://docs.ollama.com/capabilities/embeddings)
- [MCP TypeScript SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/)
- [MCP transports](https://modelcontextprotocol.io/specification/latest/basic/transports)
- [SearXNG container deployment](https://docs.searxng.org/admin/installation-docker.html)
- [SearXNG search API](https://docs.searxng.org/dev/search_api.html)

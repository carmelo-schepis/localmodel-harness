# Hugo endpoint verification

Date: 6 November 2026. Requests originated from the planning environment on the host, not a future application container. The machine clock reported UTC; the user's timezone is Australia/Sydney.

Endpoint supplied: `http://hugo.example:11434/v1`.
Native base: `http://hugo.example:11434`.
No authentication was needed for these requests. No models were downloaded, deleted, or explicitly unloaded; inference probes caused ordinary on-demand model loading.

## Observed results

- `GET /v1/models`: HTTP 200, eight installed models.
- `GET /api/version`: HTTP 200, Hugo `0.33.0`.
- `POST /api/show`: capability discovery succeeded for all eight models.
- `POST /v1/chat/completions`, `gemma3:1b`: HTTP 200, returned `connection successful`, 18.97 seconds.
- `POST /api/chat`, `qwen3:1.7b`: a bounded retry returned a structured `echo_probe` call with argument `value: harness-ok`, 8.37 seconds.
- Tool result follow-up using the matching assistant/tool messages: HTTP 200, 1.47 seconds. Output was deliberately capped at 16 tokens and ended with `done_reason: length`; this verifies replay acceptance, not answer quality.
- `POST /api/chat`, `gemma3:4b`: a synthetic 128×128 PNG containing a red square on white returned `Red`, 44.44 seconds.
- `POST /api/embed`, `embeddinggemma:latest`: HTTP 200, one 768-dimensional vector, 2.92 seconds.

The first tool and vision probes each timed out at approximately 50 seconds. Later smaller requests used a 120-second client timeout and succeeded. Requests differed in prompt/output/context budgets, and server cache/load conditions were not controlled, so timings must not be used as comparative benchmarks. The cause of the initial timeouts was not established.

See `endpoint-check.json` for timestamped structured responses and failure records. Large model templates and the embedding vector itself were omitted from the saved evidence; capability summaries and vector dimensions were retained.

## Installed models and advertised capabilities

- `embeddinggemma:latest`: embeddings.
- `gemma3:12b`, `gemma3:4b`: completion and vision.
- `gemma3:1b`, `dolphin3:8b`: completion.
- `qwen2.5-coder:7b`: completion, tools, insertion.
- `qwen3:8b`, `qwen3:1.7b`: completion, tools, thinking.

## Rechecking basic connectivity

```bash
curl --noproxy '*' --connect-timeout 5 --max-time 15 \
  http://hugo.example:11434/v1/models

curl --noproxy '*' --connect-timeout 5 --max-time 120 \
  -H 'Content-Type: application/json' \
  -d '{"model":"gemma3:1b","messages":[{"role":"user","content":"Reply with exactly: connection successful"}],"max_tokens":16,"temperature":0,"stream":false}' \
  http://hugo.example:11434/v1/chat/completions
```

## Verification boundaries

These probes establish that this host can reach Hugo and use text, a simple vision task, structured tool calls/results, and embeddings. They do not establish research quality, reliable OCR, essay quality, arbitrary model capabilities, streaming/cancellation, MCP connectivity, SearXNG operation, browser behaviour, deployment-container reachability, or two-real-server routing. No application exists yet; the implementation prompt specifies how those workflows must be built and tested.

# HUGO Harness source

Promoted from the checkout serving http://100.81.131.14:5173:

- Repository: https://github.com/carmelo-schepis/open-webui
- Branch: hugo-harness
- Source commit: 3a95dc24f
- Upstream base: b0e6098e9

The original React/Fastify application is retained in `legacy/local-harness`. Its SQLite database is a different format and must not be mounted as the Open WebUI database. Preserve its existing data directory when upgrading.

The source repository and live development server are unchanged. Upstream licenses, notices, and attribution are retained. Upstream publishing workflows are archived under `.github/upstream-workflows` so importing this source does not publish upstream releases.

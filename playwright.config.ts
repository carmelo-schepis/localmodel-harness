import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const apiPort = 4318;
const vitePort = 4319;
const mockHugoPort = 14320;
const dataDir = mkdtempSync(join(tmpdir(), 'local-harness-playwright-'));
process.env.TEST_MOCK_HUGO_URL = `http://127.0.0.1:${mockHugoPort}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${vitePort}`, headless: true },
  webServer: [
    { command: `MOCK_HUGO_PORT=${mockHugoPort} npx tsx e2e/mock-hugo-server.ts`, url: `${process.env.TEST_MOCK_HUGO_URL}/health`, reuseExistingServer: false, timeout: 30_000 },
    { command: `PORT=${apiPort} DATA_DIR=${dataDir} npm run dev:server`, url: `http://127.0.0.1:${apiPort}/api/health`, reuseExistingServer: false, timeout: 30_000 },
    { command: `API_PROXY_TARGET=http://127.0.0.1:${apiPort} npm run dev:client -- --host 127.0.0.1 --port ${vitePort} --strictPort`, url: `http://127.0.0.1:${vitePort}`, reuseExistingServer: false, timeout: 30_000 },
  ],
});

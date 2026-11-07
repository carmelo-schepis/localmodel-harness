import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Isolate the server's local SQLite file before the app module initializes its database.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'firecrawl-api-'));
const { default: app } = await import('../../src/server/index');

const fixtureWeb = (url: string) => new Response(JSON.stringify({
  success: true,
  data: { web: [{ title: 'Fixture result', url, description: 'A controlled fixture snippet.' }] },
}), { status: 200 });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Firecrawl API routes', () => {
  it('proves the browser credential reaches the controlled provider fixture', async () => {
    const fetch = vi.fn().mockResolvedValue(fixtureWeb('https://example.org/firecrawl'));
    vi.stubGlobal('fetch', fetch);
    const response = await app.inject({ method: 'POST', url: '/api/firecrawl/test', headers: { 'x-firecrawl-api-key': 'fixture-secret' } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ connected: true, resultCount: 1 });
    expect(fetch).toHaveBeenCalledWith('https://api.firecrawl.dev/v2/search', expect.objectContaining({
      headers: expect.objectContaining({ authorization: 'Bearer fixture-secret' }),
    }));
  });

  it('passes the tab credential through the manual search route', async () => {
    const fetch = vi.fn().mockResolvedValue(fixtureWeb('https://example.org/docs'));
    vi.stubGlobal('fetch', fetch);
    const response = await app.inject({ method: 'POST', url: '/api/search', headers: { 'x-firecrawl-api-key': 'fixture-secret' }, payload: { q: 'Hugo endpoint' } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ results: [{ title: 'Fixture result', url: 'https://example.org/docs', content: 'A controlled fixture snippet.' }] });
    expect(fetch).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      headers: expect.objectContaining({ authorization: 'Bearer fixture-secret' }),
    }));
  });

  it('rejects missing credentials and invalid queries without any provider request', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const missingKey = await app.inject({ method: 'POST', url: '/api/firecrawl/test' });
    expect(missingKey.statusCode).toBe(400);
    expect(missingKey.json().error).toMatch(/Enter a Firecrawl API key/);
    const shortQuery = await app.inject({ method: 'POST', url: '/api/search', payload: { q: 'q' } });
    expect(shortQuery.statusCode).toBe(400);
    expect(shortQuery.json().error).toMatch(/2 and 300/);
    expect(fetch).not.toHaveBeenCalled();
  });
});

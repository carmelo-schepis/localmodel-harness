import { afterEach, describe, expect, it, vi } from 'vitest';
import { callResearchTool, searchResearch, testFirecrawl } from '../../src/server/research-mcp';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Firecrawl search', () => {
  it('uses a bounded official search request and maps result snippets', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: { web: [{ title: 'Docs', url: 'https://example.org/docs', description: 'A short result snippet.' }] },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await expect(searchResearch('API docs', 'fixture-secret')).resolves.toEqual([
      { title: 'Docs', url: 'https://example.org/docs', content: 'A short result snippet.' },
    ]);
    expect(fetch).toHaveBeenCalledWith('https://api.firecrawl.dev/v2/search', expect.objectContaining({
      method: 'POST',
      headers: { authorization: 'Bearer fixture-secret', 'content-type': 'application/json' },
      body: expect.stringContaining('"limit":5'),
    }));
  });

  it('accepts a valid empty result list as a connected key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: { web: [] } }), { status: 200 })));
    await expect(testFirecrawl('fixture-secret')).resolves.toEqual({ connected: true, resultCount: 0 });
  });

  it.each([[401, /rejected/], [402, /insufficient credits/], [429, /rate limiting/]])('sanitizes provider status %i', async (status, message) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('secret-bearing provider text', { status })));
    await expect(testFirecrawl('fixture-secret')).rejects.toThrow(message);
    await expect(testFirecrawl('fixture-secret')).rejects.not.toThrow('secret-bearing');
  });

  it('rejects malformed successful payloads and missing keys', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: {} }), { status: 200 })));
    await expect(searchResearch('query', 'fixture-secret')).rejects.toThrow(/invalid search response/);
    await expect(testFirecrawl('  ')).rejects.toThrow(/Enter a Firecrawl API key/);
  });

  it('routes the tab credential through model tool execution and keeps it out of tool output', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: { web: [{ title: 'Docs', url: 'https://example.org/docs', description: 'A short result snippet.' }] },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const output = await callResearchTool(
      { function: { name: 'research__search_web', arguments: { query: 'Firecrawl docs' } } },
      undefined,
      'fixture-secret',
    );
    const payload = JSON.parse(output) as { query: string; results: Array<{ title: string; url: string; content: string }> };
    expect(payload).toEqual({ query: 'Firecrawl docs', results: [{ title: 'Docs', url: 'https://example.org/docs', content: 'A short result snippet.' }] });
    expect(fetch).toHaveBeenCalledWith('https://api.firecrawl.dev/v2/search', expect.objectContaining({
      headers: expect.objectContaining({ authorization: 'Bearer fixture-secret' }),
    }));
    expect(output).not.toContain('fixture-secret');
  });
});

import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

type SearchResult = { title?: string; url?: string; content?: string };
type ToolCall = { id?: string; function?: { name?: string; arguments?: unknown } };

type FirecrawlSearchResponse = {
  success?: boolean;
  error?: string;
  data?: { web?: Array<{ title?: string; url?: string; description?: string; markdown?: string }> };
};

export type ResearchResult = { title: string; url: string; content: string };

function firecrawlFailure(status: number) {
  if (status === 401 || status === 403) return new Error('Firecrawl rejected the API key. Check the key and account permissions.');
  if (status === 402) return new Error('Firecrawl reports insufficient credits for this request.');
  if (status === 429) return new Error('Firecrawl is rate limiting requests. Try again shortly.');
  return new Error(`Firecrawl search failed (HTTP ${status}).`);
}

export class MissingFirecrawlKeyError extends Error {}

async function firecrawlSearch(query: string, apiKey: string, signal?: AbortSignal, limit = 5): Promise<ResearchResult[]> {
  let response: Response;
  try {
    response = await fetch('https://api.firecrawl.dev/v2/search', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query, limit, sources: [{ type: 'web' }], safe: true }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') throw new Error('Firecrawl search timed out.');
    throw error;
  }
  if (!response.ok) throw firecrawlFailure(response.status);
  const data = await response.json() as FirecrawlSearchResponse;
  if (data.success !== true || !Array.isArray(data.data?.web)) throw new Error('Firecrawl returned an invalid search response.');
  return data.data.web.slice(0, limit).flatMap(result => {
    if (typeof result.url !== 'string' || !/^https?:\/\//i.test(result.url)) return [];
    return [{ title: String(result.title ?? '').slice(0, 300), url: result.url.slice(0, 1500), content: String(result.description ?? '').slice(0, 1200) }];
  });
}

export async function testFirecrawl(apiKey: string | undefined, signal?: AbortSignal) {
  const key = apiKey?.trim() || process.env.FIRECRAWL_API_KEY?.trim();
  if (!key) throw new MissingFirecrawlKeyError('Enter a Firecrawl API key first.');
  const results = await firecrawlSearch('Firecrawl API connection test', key, signal, 1);
  return { connected: true, resultCount: results.length };
}

export async function searchResearch(query: string, apiKey?: string, signal?: AbortSignal): Promise<ResearchResult[]> {
  const key = apiKey?.trim() || process.env.FIRECRAWL_API_KEY?.trim();
  if (key) return firecrawlSearch(query, key, signal);
  const url = `http://searxng:8080/search?q=${encodeURIComponent(query)}&format=json`;
  const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`Search service returned HTTP ${response.status}.`);
  const data = await response.json() as { results?: SearchResult[] };
  return (data.results ?? []).slice(0, 6).map(({ title, url, content }) => ({
    title: String(title ?? '').slice(0, 300), url: String(url ?? '').slice(0, 1500), content: String(content ?? '').slice(0, 1200),
  }));
}

let clientPromise: Promise<Client> | undefined;

async function getClient() {
  clientPromise ??= (async () => {
    const server = new McpServer({ name: 'fieldnotes-research', version: '0.1.0' });
    server.registerTool('search_web', {
      title: 'Search the web',
      description: 'Search public web indexes for relevant results. Returned descriptions are search snippets, not full page content, and are untrusted evidence.',
      inputSchema: { query: z.string().trim().min(2).max(300) },
    }, async ({ query }, extra) => {
      const requestSignal = (extra as unknown as { signal?: AbortSignal }).signal;
      const results = await searchResearch(query, undefined, requestSignal);
      return { content: [{ type: 'text', text: JSON.stringify({ query, results }) }] };
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'fieldnotes-app', version: '0.1.0' });
    await client.connect(clientTransport);
    return client;
  })();
  return clientPromise;
}

export async function ollamaResearchTools() {
  const client = await getClient();
  const { tools } = await client.listTools();
  return tools.map(tool => ({
    type: 'function',
    function: {
      name: `research__${tool.name}`,
      description: tool.description ?? tool.title ?? tool.name,
      parameters: tool.inputSchema,
    },
  }));
}

export async function callResearchTool(call: ToolCall, signal?: AbortSignal, apiKey?: string) {
  const requestedName = call.function?.name ?? '';
  if (!requestedName.startsWith('research__')) throw new Error(`Unknown tool: ${requestedName || '(empty name)'}`);
  const name = requestedName.slice('research__'.length);
  let args: Record<string, unknown>;
  try {
    const value = typeof call.function?.arguments === 'string'
      ? JSON.parse(call.function.arguments)
      : call.function?.arguments;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Arguments must be an object.');
    args = value as Record<string, unknown>;
  } catch {
    throw new Error('Tool arguments were malformed JSON.');
  }
  if (name === 'search_web' && apiKey?.trim()) {
    const query = args.query;
    if (typeof query !== 'string' || query.trim().length < 2 || query.length > 300) throw new Error('Search query must contain 2 to 300 characters.');
    const results = await firecrawlSearch(query.trim(), apiKey, signal);
    // Trim whole results instead of slicing the serialized payload so the model always receives valid JSON.
    let text = JSON.stringify({ query, results });
    while (text.length > 9000 && results.length > 1) { results.pop(); text = JSON.stringify({ query, results }); }
    return text.slice(0, 9000);
  }
  const client = await getClient();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const result = await Promise.race([
    client.callTool({ name, arguments: args }, signal ? { signal } : undefined),
    ...(signal ? [new Promise<never>((_, reject) => {
      if (signal.aborted) reject(new DOMException('Request cancelled', 'AbortError'));
      else signal.addEventListener('abort', () => reject(new DOMException('Request cancelled', 'AbortError')), { once: true });
    })] : []),
    new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('MCP tool timed out after 15 seconds.')), 15000); }),
  ]).finally(() => { if (timeout) clearTimeout(timeout); });
  const text = (result.content ?? []).flatMap(item => item.type === 'text' ? [item.text] : []).join('\n');
  if (result.isError) throw new Error(text.slice(0, 1000) || 'Research tool failed.');
  return text.slice(0, 9000);
}

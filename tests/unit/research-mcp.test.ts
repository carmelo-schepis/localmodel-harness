import { describe, expect, it } from 'vitest';
import { callResearchTool, ollamaResearchTools } from '../../src/server/research-mcp';

describe('bundled research MCP tools', () => {
  it('discovers the search tool through the MCP client protocol', async () => {
    const tools = await ollamaResearchTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      type: 'function',
      function: { name: 'research__search_web' },
    });
    expect(tools[0].function.parameters).toBeDefined();
  });

  it('rejects unnamespaced, unknown, and malformed tool calls', async () => {
    await expect(callResearchTool({ function: { name: 'shell', arguments: {} } })).rejects.toThrow('Unknown tool');
    await expect(callResearchTool({ function: { name: 'research__unknown', arguments: {} } })).rejects.toThrow();
    await expect(callResearchTool({ function: { name: 'research__search_web', arguments: '{' } })).rejects.toThrow('malformed JSON');
  });
});

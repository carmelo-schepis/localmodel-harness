import { describe, expect, it } from 'vitest';
import { endpointBases } from '../../src/server/ollama/urls';

describe('Hugo endpoint URL handling', () => {
  it('accepts an origin with an optional trailing slash', () => {
    expect(endpointBases('http://localhost:11434/')).toEqual({
      native: 'http://localhost:11434',
      openai: 'http://localhost:11434/v1',
    });
  });

  it('removes a single compatibility suffix and preserves proxy prefixes', () => {
    expect(endpointBases('https://models.example/proxy/v1/')).toEqual({
      native: 'https://models.example/proxy',
      openai: 'https://models.example/proxy/v1',
    });
  });

  it('rejects embedded credentials and query or fragment ambiguity', () => {
    for (const url of [
      'http://user:pass@localhost:11434/v1',
      'http://localhost:11434/v1?token=hidden',
      'http://localhost:11434/v1#fragment',
      'ftp://localhost:11434',
    ]) expect(() => endpointBases(url)).toThrow();
  });
});

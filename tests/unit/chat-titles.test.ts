import { describe, expect, it } from 'vitest';
import { chooseTitleModel, cleanTitle, isGenericProjectName, titleExcerpt } from '../../src/server/chat-titles';

describe('background chat titles', () => {
  it('selects the smallest resident completion model and excludes embeddings', () => {
    const models = [
      { name: 'embedding', size: 5, capabilities: ['embedding'] },
      { name: 'small', size: 10, capabilities: ['completion'] },
      { name: 'large', size: 100, capabilities: ['completion'] },
    ];
    expect(chooseTitleModel(models, new Set(['embedding', 'large']))?.name).toBe('large');
    expect(chooseTitleModel(models, new Set(['embedding']))).toBeUndefined();
  });

  it('uses a stable name tie break and ignores unusable sizes', () => {
    const models = [
      { name: 'zeta', size: 10, capabilities: ['completion'] },
      { name: 'alpha', size: 10, capabilities: ['completion'] },
      { name: 'unknown', capabilities: ['completion'] },
    ];
    expect(chooseTitleModel(models, new Set(models.map(model => model.name)))?.name).toBe('alpha');
  });

  it('cleans and bounds model output', () => {
    expect(cleanTitle(' Title: “Saffron Lantern Research”\n')).toBe('Saffron Lantern Research');
    expect(cleanTitle('')).toBeUndefined();
    expect(cleanTitle('x'.repeat(61))).toBeUndefined();
  });

  it('uses only a bounded first-turn excerpt and recognizes fallback project names', () => {
    expect(titleExcerpt(`Question\n\nAttached source material: private corpus`).length).toBeLessThan(40);
    expect(titleExcerpt('x'.repeat(5000))).toHaveLength(2000);
    expect(isGenericProjectName('Chat 4')).toBe(true);
    expect(isGenericProjectName('Quarterly plan')).toBe(false);
  });
});

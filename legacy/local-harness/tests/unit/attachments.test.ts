import { describe, expect, it } from 'vitest';
import { chooseVisionModel, classifyAttachment, MAX_ATTACHMENT_BYTES, MAX_CHAT_BODY_BYTES, MAX_DOCUMENT_CHARS, MAX_IMAGE_REQUEST_CHARS } from '../../src/client/app/attachments';

describe('attachment classification and limits', () => {
  it('accepts supported images by MIME type or extension and supported documents by extension', () => {
    expect(classifyAttachment({ name: 'photo', type: 'image/webp' })).toBe('image');
    expect(classifyAttachment({ name: 'photo.JPG', type: '' })).toBe('image');
    expect(classifyAttachment({ name: 'notes.ndjson', type: 'application/octet-stream' })).toBe('document');
    expect(classifyAttachment({ name: 'scan.pdf', type: 'application/pdf' })).toBe('document');
    expect(classifyAttachment({ name: 'archive.zip', type: 'application/zip' })).toBe('unsupported');
  });

  it('uses the existing upload and chat context limits', () => {
    expect(MAX_ATTACHMENT_BYTES).toBe(10 * 1024 * 1024);
    expect(MAX_IMAGE_REQUEST_CHARS).toBe(12 * 1024 * 1024);
    expect(MAX_CHAT_BODY_BYTES).toBe(12 * 1024 * 1024);
    expect(MAX_DOCUMENT_CHARS).toBe(20_000);
  });
});

describe('vision model selection', () => {
  const models = [
    { name: 'text', capabilities: ['completion', 'tools'], size: 1 },
    { name: 'embed', capabilities: ['embedding', 'vision'], size: 1 },
    { name: 'large-vision', capabilities: ['completion', 'vision'], size: 12 },
    { name: 'small-vision', capabilities: ['completion', 'vision'], size: 4 },
  ];

  it('keeps the selected compatible model', () => {
    expect(chooseVisionModel(models, 'large-vision')?.name).toBe('large-vision');
  });

  it('chooses the smaller compatible model and excludes embedding-only models', () => {
    expect(chooseVisionModel(models, 'text')?.name).toBe('small-vision');
  });

  it('uses stable discovery order when no size metadata exists', () => {
    const candidates = models.slice(2).map(({ name, capabilities }) => ({ name, capabilities }));
    expect(chooseVisionModel(candidates, 'text')?.name).toBe('large-vision');
  });
});

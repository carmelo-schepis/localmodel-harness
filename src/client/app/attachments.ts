export type DiscoveredModel = { name: string; capabilities: string[]; size?: number };

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_REQUEST_CHARS = 12 * 1024 * 1024;
export const MAX_CHAT_BODY_BYTES = 12 * 1024 * 1024;
export const MAX_DOCUMENT_CHARS = 20_000;
export const MAX_DOCUMENT_CONTEXT_CHARS = 50_000;

const imageTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
const imageExtensions = /\.(png|jpe?g|webp)$/i;
const documentExtensions = /\.(txt|md|csv|json|ndjson|log|pdf|docx)$/i;

export function classifyAttachment(file: Pick<File, 'name' | 'type'>): 'image' | 'document' | 'unsupported' {
  if (imageTypes.has(file.type) || imageExtensions.test(file.name)) return 'image';
  if (documentExtensions.test(file.name)) return 'document';
  return 'unsupported';
}

export function chooseVisionModel(models: DiscoveredModel[], current: string): DiscoveredModel | undefined {
  const candidates = models.filter(model => model.capabilities.includes('completion') && model.capabilities.includes('vision'));
  const selected = candidates.find(model => model.name === current);
  if (selected) return selected;
  return candidates.reduce<DiscoveredModel | undefined>((best, candidate) => {
    if (!best) return candidate;
    if (typeof candidate.size === 'number' && typeof best.size === 'number' && candidate.size < best.size) return candidate;
    if (typeof candidate.size === 'number' && best.size === undefined) return candidate;
    return best;
  }, undefined);
}

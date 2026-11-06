export function endpointBases(input: string) {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error('Enter a valid Ollama URL, such as http://localhost:11434/v1');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Use an HTTP(S) endpoint without credentials, query, or fragment.');
  }
  let path = url.pathname.replace(/\/+$/, '');
  if (path.endsWith('/v1')) path = path.slice(0, -3);
  return { native: `${url.origin}${path}`, openai: `${url.origin}${path}/v1` };
}

/** Cookie mutations need positive same-origin evidence; non-browser clients remain usable. */
export function actionOriginAllowed(request: Request): boolean {
  const site = request.headers.get('Sec-Fetch-Site');
  if (site === 'cross-site') return false;
  const origin = new URL(request.url).origin;
  const supplied = request.headers.get('Origin');
  if (supplied !== null) return supplied === origin;
  const referer = request.headers.get('Referer');
  if (referer !== null) {
    try { return new URL(referer).origin === origin; } catch { return false; }
  }
  if (site === 'same-origin') return true;
  return site !== 'same-site' && !request.headers.has('Cookie');
}

/** Bound the original stream before formData(), clone() or user code can buffer it. */
export async function readActionRequest(request: Request, limit: number, signal: AbortSignal): Promise<Request> {
  const tooLarge = () => new Response('Request body too large', { status: 413, headers: { 'Cache-Control': 'no-store' } });
  if (Number(request.headers.get('Content-Length')) > limit) {
    void request.body?.cancel().catch(() => {});
    throw tooLarge();
  }
  if (!request.body) return request;
  const reader = request.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) { cancel(); throw tooLarge(); }
      chunks.push(value);
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return new Request(request, { body, signal });
  } finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
}

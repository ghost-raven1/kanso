import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** Cancelling an oversized upload must still allow the HTTP error response to be sent. */
function requestBody(incoming: IncomingMessage, outgoing: ServerResponse): ReadableStream<Uint8Array> {
  let remove = () => {};
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const data = (chunk: Buffer) => { incoming.pause(); controller.enqueue(chunk); };
      const end = () => { remove(); controller.close(); };
      const error = (reason: Error) => { remove(); controller.error(reason); };
      remove = () => { incoming.off('data', data); incoming.off('end', end); incoming.off('error', error); };
      incoming.on('data', data); incoming.once('end', end); incoming.once('error', error);
      incoming.pause();
    },
    pull() { incoming.resume(); },
    cancel() {
      remove(); incoming.pause();
      // Close after the response instead of destroying the socket before a 413 can be written.
      outgoing.shouldKeepAlive = false;
    },
  }, { highWaterMark: 0 });
}

/** Adapt Node HTTP without buffering incoming form bodies or losing aborts. */
export function nodeHandler(handler: (request: Request) => Promise<Response>, origin: string) {
  const base = new URL(origin);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw new Error('Expected an HTTP(S) server origin.');
  return async (incoming: IncomingMessage, outgoing: ServerResponse): Promise<void> => {
    const controller = new AbortController();
    incoming.once('aborted', () => controller.abort());
    incoming.once('error', () => controller.abort());
    outgoing.once('close', () => { if (!outgoing.writableEnded) controller.abort(); });
    try {
      // HTTP origin-form only: //host and backslashes must not replace the trusted origin.
      const target = incoming.url ?? '/';
      const url = new URL(target, base.origin);
      if (!target.startsWith('/') || target.startsWith('//') || url.origin !== base.origin || target.includes('\\')) {
        outgoing.statusCode = 400;
        outgoing.setHeader('Cache-Control', 'no-store');
        outgoing.end('Invalid request target');
        return;
      }
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        for (const item of Array.isArray(value) ? value : value ? [value] : []) headers.append(name, item);
      }
      const method = incoming.method ?? 'GET';
      const init: RequestInit & { duplex?: 'half' } = { method, headers, signal: controller.signal };
      if (!['GET', 'HEAD'].includes(method)) { init.body = requestBody(incoming, outgoing); init.duplex = 'half'; }
      const response = await handler(new Request(url, init));
      outgoing.statusCode = response.status;
      response.headers.forEach((value, key) => { if (key !== 'set-cookie') outgoing.setHeader(key, value); });
      const cookies = response.headers.getSetCookie();
      if (cookies.length) outgoing.setHeader('set-cookie', cookies);
      if (response.body && method !== 'HEAD') await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), outgoing);
      else outgoing.end();
    } catch {
      if (!outgoing.headersSent) outgoing.statusCode = 500;
      outgoing.end('Request failed');
    }
  };
}

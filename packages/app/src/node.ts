import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** Adapt Node HTTP without buffering incoming form bodies or losing aborts. */
export function nodeHandler(handler: (request: Request) => Promise<Response>, origin: string) {
  return async (incoming: IncomingMessage, outgoing: ServerResponse): Promise<void> => {
    const controller = new AbortController();
    incoming.once('aborted', () => controller.abort());
    outgoing.once('close', () => { if (!outgoing.writableEnded) controller.abort(); });
    try {
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        for (const item of Array.isArray(value) ? value : value ? [value] : []) headers.append(name, item);
      }
      const method = incoming.method ?? 'GET';
      const init: RequestInit & { duplex?: 'half' } = { method, headers, signal: controller.signal };
      if (!['GET', 'HEAD'].includes(method)) { init.body = Readable.toWeb(incoming) as ReadableStream<Uint8Array>; init.duplex = 'half'; }
      const response = await handler(new Request(new URL(incoming.url ?? '/', origin), init));
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

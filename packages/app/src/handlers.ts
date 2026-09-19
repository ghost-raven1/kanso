import type { Route } from './types.js';
import type { RouteId, TypedRouteHandlers } from './routes.js';

/** Validate handler identities while retaining inferred loader and action results. */
export function defineRouteHandlers<const R extends Route[], H extends TypedRouteHandlers<R>>(
  _routes: R,
  handlers: H & { [K in keyof H]: K extends RouteId<R> ? TypedRouteHandlers<R>[K] : never },
): H {
  return handlers;
}

/** POST/Redirect/GET by default; headers such as Set-Cookie remain intact. */
export function redirect(url: string, status: 301 | 302 | 303 | 307 | 308 = 303, headers?: HeadersInit): Response {
  const result = new Headers(headers);
  result.set('Location', url);
  return new Response(null, { status, headers: result });
}

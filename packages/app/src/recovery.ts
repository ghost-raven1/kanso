import { createComponent } from 'solid-js';
import { Dynamic } from 'solid-js/web';

export const FORM_BUILD = '__kanso_build';
const releaseCodes = new Set(['APP_BUILD_MISMATCH', 'MF_RELEASE_MISMATCH', 'MF_RUNTIME_MISMATCH', 'MF_SHARED_MISMATCH']);

/** Recovery is explicit: a rejected submission is never retried against a different release. */
export function requiresReload(error: unknown): boolean {
  const value = error as { code?: string; status?: number; reload?: boolean; name?: string } | null;
  return !!value && (value.reload === true || value.status === 409 && value.name === 'RemoteError' || releaseCodes.has(value.code ?? ''));
}
export function responseError(response: Response, operation: string): Error {
  const reload = response.headers.get('X-Kanso-Recovery') === 'reload';
  return Object.assign(new Error(reload
    ? 'This page uses an unavailable release. Copy any unsaved input, then reload the page. Your submission was not retried.'
    : `${operation}: HTTP ${response.status}`), {
    status: response.status, code: response.headers.get('X-Kanso-Error'), reload,
  });
}
export function RouteRecovery(props: { error: unknown }) {
  return createComponent(Dynamic, {
    component: 'div', role: 'alert',
    children: requiresReload(props.error) ? [
      createComponent(Dynamic, { component: 'p', children: 'This page uses an unavailable release. Copy any unsaved input before reloading.' }),
      createComponent(Dynamic, { component: 'button', type: 'button', onClick: () => window.location.reload(), children: 'Reload page' }),
    ] : 'Unable to load this route.',
  });
}

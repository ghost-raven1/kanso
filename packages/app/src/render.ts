import { createComponent } from 'solid-js';
import { generateHydrationScript, renderToStringAsync, useAssets } from 'solid-js/web';
import { App } from './router.js';
import { serialize } from './serialization.js';
import { createHeadRegistry } from './seo/registry.js';
import { routeSeoLevels } from './seo/routes.js';
import { renderHead } from './seo/resolve.js';
import type { SeoSnapshot } from './seo/types.js';
import type { Bootstrap, RequestHandlerOptions } from './types.js';
import { REMOTE_VERSIONS } from './microfrontends.js';
import { SSR_REMOTE_PINS } from './forms.js';

const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

/** Resolve head after lazy fragments, then embed this request's bootstrap safely. */
export async function renderPage(options: Pick<RequestHandlerOptions, 'routes' | 'assets' | 'seo' | 'timeoutMs' | 'buildId' | 'microfrontends' | 'microfrontendSession'>, bootstrap: Bootstrap, status = 200): Promise<Response> {
  const head = options.seo ? createHeadRegistry(options.seo, () => bootstrap.url) : undefined;
  if (head) head.setSource(() => routeSeoLevels(options.routes, bootstrap, bootstrap.url, head.config));
  let snapshot: SeoSnapshot | undefined;
  let html = await renderToStringAsync(() => {
    if (head) useAssets(() => { snapshot = head.resolve(); return ''; });
    return createComponent(App, { routes: options.routes, url: bootstrap.url, bootstrap, seo: options.seo, head, microfrontends: options.microfrontends, microfrontendSession: options.microfrontendSession });
  }, { timeoutMs: options.timeoutMs ?? 10000 });
  if (options.microfrontendSession?.renderError) throw options.microfrontendSession.renderError;
  if (snapshot) bootstrap.seo = snapshot;
  if (options.microfrontendSession) {
    bootstrap.remotes = options.microfrontendSession.pins();
    const pins = escape(serialize(bootstrap.remotes));
    // Forms may precede lazy widgets in the stream. Only finalize framework-owned pin inputs.
    html = html.replace(/<input\b[^>]*>/g, input =>
      input.includes(`name="${REMOTE_VERSIONS}"`) && input.includes('type="hidden"')
        ? input.replace(`value="${SSR_REMOTE_PINS}"`, () => `value="${pins}"`)
        : input);
  }
  const headHtml = snapshot ? renderHead(snapshot) : '';
  const htmlAttrs = snapshot ? `${snapshot.lang ? ` lang="${escape(snapshot.lang)}"` : ''}${snapshot.dir ? ` dir="${escape(snapshot.dir)}"` : ''}` : ' lang="en"';
  const remoteAssets = options.microfrontendSession?.assets();
  const styles = [...new Set([...(options.assets.styles ?? []), ...(remoteAssets?.styles ?? [])])].map(href => `<link rel="stylesheet" href="${escape(href)}">`).join('');
  const preloads = [...new Set([...(options.assets.preloads ?? []), ...(remoteAssets?.preloads ?? [])])].map(href => `<link rel="modulepreload" href="${escape(href)}">`).join('');
  const document = `<!doctype html><html${htmlAttrs}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${headHtml}${styles}${preloads}${generateHydrationScript()}<script id="kanso-data" type="application/json">${serialize(bootstrap)}</script></head><body><div id="root">${html}</div><script type="module" src="${escape(options.assets.entry)}"></script></body></html>`;
  return new Response(document, { status, headers: {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Kanso-Build': options.buildId,
    ...(snapshot?.noindex ? { 'X-Robots-Tag': 'noindex' } : {}),
  } });
}

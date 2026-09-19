import type { RequestHandlerOptions, Route } from '../types.js';
import type { SeoMetadata, SitemapEntry } from './types.js';
import { absoluteUrl, canonicalUrl, escapeHtml, mergeSeo } from './resolve.js';

const start = '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">';
const end = '</urlset>';
const bytes = (text: string) => new TextEncoder().encode(text).byteLength;
const location = (value: string, siteUrl: string) => {
  const result = canonicalUrl(value, siteUrl);
  if (new URL(result).origin !== new URL(siteUrl).origin) throw new Error('KANSO_SITEMAP_ORIGIN: sitemap URLs must belong to siteUrl.');
  return result;
};
function entryXml(entry: SitemapEntry, siteUrl: string): string {
  let xml = `<url><loc>${escapeHtml(location(entry.url, siteUrl))}</loc>`;
  if (entry.lastmod !== undefined) {
    const date = entry.lastmod instanceof Date ? entry.lastmod.toISOString() : entry.lastmod;
    if (!/^\d{4}-\d{2}-\d{2}(?:T.+)?$/.test(date) || !Number.isFinite(Date.parse(date))) throw new Error('KANSO_SITEMAP_DATE: lastmod must be an ISO date.');
    xml += `<lastmod>${escapeHtml(date)}</lastmod>`;
  }
  for (const [lang, href] of Object.entries(entry.alternates ?? {})) {
    if (!/^(?:x-default|[a-z]{2,3}(?:-[a-z0-9]{2,8})*)$/i.test(lang)) throw new Error('KANSO_SITEMAP_LANGUAGE: invalid hreflang.');
    xml += `<xhtml:link rel="alternate" hreflang="${escapeHtml(lang)}" href="${escapeHtml(absoluteUrl(href, siteUrl))}"/>`;
  }
  return xml + '</url>';
}
/** Split by encoded byte size as well as URL count; limits include the XML envelope. */
export async function buildSitemapParts(entries: AsyncIterable<SitemapEntry> | Iterable<SitemapEntry>, siteUrl: string, signal: AbortSignal, limits = { urls: 50000, bytes: 50 * 1024 * 1024 }): Promise<string[]> {
  const parts: string[] = [];
  const seen = new Set<string>();
  let rows: string[] = [];
  let size = bytes(start + end);
  for await (const entry of entries) {
    signal.throwIfAborted();
    const url = location(entry.url, siteUrl);
    if (seen.has(url)) continue;
    seen.add(url);
    const row = entryXml({ ...entry, url }, siteUrl);
    const length = bytes(row);
    if (length + bytes(start + end) > limits.bytes) throw new Error('KANSO_SITEMAP_SIZE: one URL entry exceeds the XML size limit.');
    if (rows.length && (rows.length === limits.urls || size + length > limits.bytes)) {
      parts.push(start + rows.join('') + end); rows = []; size = bytes(start + end);
    }
    rows.push(row); size += length;
  }
  if (rows.length || !parts.length) parts.push(start + rows.join('') + end);
  return parts;
}
function staticEntries(routes: Route[], siteUrl: string, defaults: SeoMetadata): SitemapEntry[] {
  const entries: SitemapEntry[] = [];
  const visit = (items: Route[], prefix: string, inherited: SeoMetadata) => {
    for (const route of items) {
      const path = (prefix + '/' + route.path).replace(/\/+/g, '/');
      const metadata = typeof route.seo === 'object' ? mergeSeo(inherited, route.seo) : inherited;
      if (route.sitemap && !/[:*]/.test(path) && metadata.robots?.index !== false && metadata.canonical !== null) {
        const options = route.sitemap === true ? {} : route.sitemap;
        const alternates = Object.fromEntries(Object.entries(metadata.alternates ?? {}).filter((entry): entry is [string, string] => entry[1] !== null));
        entries.push({ url: metadata.canonical ?? path, ...(Object.keys(alternates).length ? { alternates } : {}), ...options });
      }
      visit(route.children ?? [], path, metadata);
    }
  };
  visit(routes, '', defaults);
  // Normalize before handing data to the common chunker.
  return entries.map(entry => ({ ...entry, url: location(entry.url, siteUrl) }));
}
interface Generation { id: string; parts: string[]; created: number }

/** Discovery endpoints share public generation data, never request-specific loader state. */
export function createSeoDiscovery(options: Pick<RequestHandlerOptions, 'seo' | 'sitemap' | 'robots' | 'routes'>) {
  const config = options.seo;
  const ttl = options.sitemap?.ttlMs ?? 300000;
  if (!(ttl > 0)) throw new Error('KANSO_SITEMAP_TTL: ttlMs must be positive.');
  const generations = new Map<string, Generation>();
  let current: Generation | undefined;
  let pending: Promise<Generation> | undefined;
  const enabled = !!config && config.indexable !== false && (!!options.sitemap || options.routes.some(function has(route): boolean { return !!route.sitemap || !!route.children?.some(has); }));
  const generate = (signal: AbortSignal) => {
    if (current && Date.now() - current.created < ttl) return Promise.resolve(current);
    if (pending) return pending;
    const work = (async () => {
      const configured = await options.sitemap?.entries?.({ signal }) ?? [];
      const entries = async function* () { yield* staticEntries(options.routes, config!.siteUrl, config!); yield* configured; };
      const parts = await buildSitemapParts(entries(), config!.siteUrl, signal);
      signal.throwIfAborted();
      const result = { id: crypto.randomUUID(), parts, created: Date.now() };
      for (const [id, generation] of generations) if (result.created - generation.created > ttl * 2) generations.delete(id);
      generations.set(result.id, result); current = result;
      return result;
    })();
    let removeAbort = () => {};
    const cancelled = new Promise<never>((_resolve, reject) => {
      const abort = () => reject(signal.reason);
      if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
      removeAbort = () => signal.removeEventListener('abort', abort);
    });
    pending = Promise.race([work, cancelled]).finally(() => { removeAbort(); pending = undefined; });
    return pending;
  };
  return async (request: Request, signal: AbortSignal): Promise<Response | undefined> => {
    const path = new URL(request.url).pathname;
    if (!['/robots.txt', '/sitemap.xml'].includes(path) && !path.startsWith('/_kanso/sitemap/')) return undefined;
    if (!config) return undefined;
    if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
    const response = (body: string, type: string, cache = 'no-cache') => new Response(request.method === 'HEAD' ? null : body, { headers: { 'Content-Type': type, 'Cache-Control': cache } });
    if (path === '/robots.txt') {
      const lines: string[] = [];
      const line = (name: string, value: string) => { if (/[\r\n]/.test(value)) throw new Error('KANSO_ROBOTS_RULE: rules must fit on one line.'); lines.push(`${name}: ${value}`); };
      for (const group of options.robots?.groups ?? [{ userAgent: '*', allow: ['/'] }]) {
        for (const agent of typeof group.userAgent === 'string' ? [group.userAgent] : group.userAgent) line('User-agent', agent);
        for (const value of group.allow ?? []) line('Allow', value);
        for (const value of group.disallow ?? []) line('Disallow', value);
        lines.push('');
      }
      if (config.indexable !== false) for (const url of [...(enabled ? ['/sitemap.xml'] : []), ...options.robots?.sitemaps ?? []]) line('Sitemap', absoluteUrl(url, config.siteUrl));
      return response(lines.join('\n') + '\n', 'text/plain; charset=utf-8');
    }
    if (!enabled) return new Response(null, { status: 404 });
    if (path !== '/sitemap.xml') {
      const match = /^\/_kanso\/sitemap\/([\w-]+)\/(\d+)\.xml$/.exec(path);
      const generation = match && generations.get(match[1]);
      const part = generation && Date.now() - generation.created <= ttl * 2 ? generation.parts[Number(match![2])] : undefined;
      return part === undefined ? new Response(null, { status: 404 }) : response(part, 'application/xml; charset=utf-8');
    }
    const generation = await generate(signal);
    if (generation.parts.length === 1) return response(generation.parts[0], 'application/xml; charset=utf-8');
    const parts = generation.parts.map((_part, index) => `<sitemap><loc>${escapeHtml(absoluteUrl(`/_kanso/sitemap/${generation.id}/${index}.xml`, config.siteUrl))}</loc></sitemap>`).join('');
    return response(`<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${parts}</sitemapindex>`, 'application/xml; charset=utf-8');
  };
}

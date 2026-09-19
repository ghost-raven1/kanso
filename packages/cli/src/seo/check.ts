import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { inspectSeoHtml, type SeoDiagnostic } from './html.js';
export interface SeoCheckOptions { url: string; maxPages?: number; fetcher?: typeof fetch }
export interface SeoCheckReport { pages: number; truncated: boolean; diagnostics: SeoDiagnostic[] }

/** Crawl an explicit origin's source HTML and sitemaps; never follow external redirects. */
export async function checkSeo(options: SeoCheckOptions): Promise<SeoCheckReport> {
  const root = new URL(options.url);
  if (!['http:', 'https:'].includes(root.protocol) || root.username || root.password) throw new Error('SEO check requires an HTTP(S) URL without credentials.');
  const limit = options.maxPages ?? 200;
  if (!Number.isInteger(limit) || limit < 1) throw new Error('--max-pages must be a positive integer.');
  const fetcher = options.fetcher ?? fetch;
  const diagnostics: SeoDiagnostic[] = [];
  const pages = new Map<string, boolean>([[root.href, false]]);
  const maps = [new URL('/sitemap.xml', root).href];
  const visited = new Set<string>();
  let truncated = false;
  const report = (url: string, code: string, field: string, message: string, severity: SeoDiagnostic['severity'] = 'error') => diagnostics.push({ severity, url, code, field, message });
  const request = (url: string) => fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
  const addUrl = (value: unknown, from: string, sitemap: boolean) => {
    if (typeof value !== 'string') { report(from, 'SEO_SITEMAP_URL', 'loc', 'Supply an absolute URL in every loc.'); return; }
    let url: URL;
    try { url = new URL(value); } catch { report(from, 'SEO_SITEMAP_URL', 'loc', `Invalid absolute URL: ${value}`); return; }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) { report(from, 'SEO_SITEMAP_URL', 'loc', 'Use HTTP(S) URLs without credentials.'); return; }
    if (url.origin !== root.origin) { report(from, 'SEO_EXTERNAL_SKIPPED', 'loc', `Skipped another origin: ${url.origin}`, 'warning'); return; }
    url.hash = '';
    if (sitemap) { if (!visited.has(url.href)) maps.push(url.href); }
    else if (pages.has(url.href)) pages.set(url.href, true);
    else if (pages.size < limit) pages.set(url.href, true);
    else truncated = true;
  };
  const robots = await request(new URL('/robots.txt', root).href);
  if (robots.ok) for (const line of (await robots.text()).split(/\r?\n/)) {
    const match = /^Sitemap:\s*(\S+)/i.exec(line); if (match) addUrl(match[1], robots.url || root.href, true);
  }
  const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false, removeNSPrefix: true, isArray: name => ['sitemap', 'url'].includes(name) });
  while (maps.length) {
    const url = maps.shift()!;
    if (visited.has(url)) continue;
    if (visited.size >= limit) { truncated = true; break; }
    visited.add(url);
    const response = await request(url);
    if (response.status === 404 && url === new URL('/sitemap.xml', root).href) continue;
    if (!response.ok) { report(url, 'SEO_SITEMAP_STATUS', 'status', `Sitemap returned HTTP ${response.status}.`); continue; }
    const xml = await response.text();
    if (/<!DOCTYPE/i.test(xml) || XMLValidator.validate(xml) !== true) { report(url, 'SEO_SITEMAP_XML', 'sitemap', 'Publish well-formed XML without a DOCTYPE.'); continue; }
    const data = parser.parse(xml);
    if (Object.hasOwn(data, 'sitemapindex')) for (const entry of data.sitemapindex.sitemap ?? []) addUrl(entry.loc, url, true);
    else if (Object.hasOwn(data, 'urlset')) for (const entry of data.urlset.url ?? []) addUrl(entry.loc, url, false);
    else report(url, 'SEO_SITEMAP_XML', 'sitemap', 'Expected urlset or sitemapindex.');
  }
  const titles = new Map<string, string>();
  for (const [url, indexed] of pages) {
    const response = await request(url);
    if (!response.ok) { report(url, 'SEO_PAGE_STATUS', 'status', `Page returned HTTP ${response.status}${indexed ? ' but is listed in sitemap' : ''}.`); continue; }
    if (!(response.headers.get('Content-Type') ?? '').includes('text/html')) { report(url, 'SEO_CONTENT_TYPE', 'content-type', 'Expected an HTML page.'); continue; }
    const result = inspectSeoHtml(await response.text(), url, response.headers);
    diagnostics.push(...result.diagnostics);
    if (indexed && result.noindex) report(url, 'SEO_SITEMAP_NOINDEX', 'robots', 'Remove this noindex page from sitemap or intentionally allow indexing.');
    if (indexed && result.canonical && result.canonical !== url) report(url, 'SEO_SITEMAP_CANONICAL', 'canonical', 'List the canonical URL in sitemap instead of this alternative.');
    if (result.title) {
      const other = titles.get(result.title);
      if (other && other !== url) report(url, 'SEO_REPEATED_TITLE', 'title', `Use a distinct title; also present at ${other}.`, 'warning');
      titles.set(result.title, url);
    }
  }
  if (truncated) report(root.href, 'SEO_TRUNCATED', 'max-pages', `Partial audit: reached the ${limit} page/sitemap limit. Increase --max-pages for a complete report.`, 'warning');
  return { pages: pages.size, truncated, diagnostics };
}

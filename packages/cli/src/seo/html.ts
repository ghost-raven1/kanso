import { parse } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';
export interface SeoDiagnostic { severity: 'error' | 'warning'; code: string; url: string; field: string; message: string }
export interface PageInspection { title?: string; canonical?: string; noindex: boolean; diagnostics: SeoDiagnostic[] }
type Node = DefaultTreeAdapterMap['node'];
const text = (node: Node): string => node.nodeName === '#text' ? (node as DefaultTreeAdapterMap['textNode']).value : 'childNodes' in node ? node.childNodes.map(text).join('') : '';
const webUrl = (value: string) => { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; } };

/** Inspect the actual HTTP document; no browser rendering or script execution is needed. */
export function inspectSeoHtml(html: string, url: string, headers = new Headers()): PageInspection {
  const diagnostics: SeoDiagnostic[] = [];
  const report = (severity: SeoDiagnostic['severity'], code: string, field: string, message: string) => diagnostics.push({ severity, code, url, field, message });
  const values = new Map<string, string[]>();
  const add = (key: string, value: string) => values.set(key, [...values.get(key) ?? [], value]);
  const jsonIds = new Set<string>();
  const visit = (node: Node, inHead = false) => {
    if ('tagName' in node) {
      inHead ||= node.tagName === 'head';
      const attr = Object.fromEntries(node.attrs.map(item => [item.name, item.value]));
      if (node.tagName === 'title') add('title', text(node));
      if (node.tagName === 'meta') {
        const name = (attr.name ?? attr.property ?? '').toLowerCase();
        if (name) add(name, attr.content ?? '');
      }
      if (node.tagName === 'link' && attr.rel?.toLowerCase() === 'canonical') {
        add('canonical', attr.href ?? '');
        if (!inHead) report('error', 'SEO_CANONICAL_LOCATION', 'canonical', 'Move canonical into the document head.');
      }
      if (node.tagName === 'link' && attr.hreflang) {
        add(`hreflang:${attr.hreflang.toLowerCase()}`, attr.href ?? '');
        if (!/^(?:x-default|[a-z]{2,3}(?:-[a-z0-9]{2,8})*)$/i.test(attr.hreflang)) report('error', 'SEO_HREFLANG', 'hreflang', 'Use a valid language tag or x-default.');
      }
      if (node.tagName === 'script' && attr.type?.toLowerCase() === 'application/ld+json') {
        const id = attr['data-kanso-head'] ?? attr.id;
        if (id && jsonIds.has(id)) report('error', 'SEO_JSON_LD_DUPLICATE', 'jsonLd', `Use a distinct JSON-LD id instead of ${id}.`);
        if (id) jsonIds.add(id);
        try {
          const data = JSON.parse(text(node));
          const valid = (value: unknown): boolean => !!value && typeof value === 'object' && !Array.isArray(value)
            && (typeof (value as Record<string, unknown>)['@type'] === 'string' || Array.isArray((value as Record<string, unknown>)['@type'])
              || Array.isArray((value as Record<string, unknown>)['@graph']) && ((value as Record<string, unknown>)['@graph'] as unknown[]).every(valid));
          if (!(Array.isArray(data) ? data.length > 0 && data.every(valid) : valid(data))) throw new Error('missing @type or @graph');
        } catch { report('error', 'SEO_JSON_LD', 'jsonLd', 'Supply valid JSON-LD containing @type or @graph.'); }
      }
    }
    if ('childNodes' in node) node.childNodes.forEach(child => visit(child, inHead));
  };
  visit(parse(html));
  for (const [key, list] of values) {
    const multipleImage = /^(?:og|twitter):image(?::(?:width|height|alt|type))?$/.test(key);
    if (!multipleImage && (['title', 'description', 'canonical', 'robots'].includes(key) || key.startsWith('og:') || key.startsWith('twitter:') || key.startsWith('hreflang:')) && list.length > 1) {
      report('error', 'SEO_DUPLICATE', key, `Keep one ${key} entry; found ${list.length}.`);
    }
    if (['canonical', 'og:url', 'og:image', 'twitter:image'].includes(key) || key.startsWith('hreflang:')) for (const value of list) {
      if (!webUrl(value)) report('error', 'SEO_URL', key, 'Use an absolute HTTP(S) URL without credentials.');
    }
  }
  for (const field of ['title', 'description', 'canonical']) if (!values.get(field)?.[0]?.trim()) report('warning', 'SEO_MISSING', field, `Add ${field} metadata for this page.`);
  if (!values.get('og:title')?.[0] || !values.get('og:image')?.[0]) report('warning', 'SEO_SOCIAL', 'openGraph', 'Supply a title and image for a complete social card.');
  const directives = [...values.get('robots') ?? [], ...values.get('googlebot') ?? [], headers.get('X-Robots-Tag') ?? ''].join(',').toLowerCase().split(/[\s,:]+/);
  if (directives.includes('index') && directives.includes('noindex')) report('error', 'SEO_ROBOTS_CONFLICT', 'robots', 'Remove conflicting index and noindex directives.');
  return { title: values.get('title')?.[0], canonical: values.get('canonical')?.[0], noindex: directives.includes('noindex') || directives.includes('none'), diagnostics };
}

import { serialize } from '../serialization.js';
import type { HeadTag, SeoConfig, SeoMetadata, SeoResolver, SeoResolverArgs, SeoSnapshot, SeoImageInput, RobotsMetadata } from './types.js';

/** URLs must be explicit HTTP(S) locations, never inferred from an incoming Host header. */
export function absoluteUrl(value: string, base: string): string {
  const url = new URL(value, base);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('KANSO_SEO_URL: expected an HTTP(S) URL without credentials.');
  return url.href;
}
export function canonicalUrl(value: string, base: string): string {
  const url = new URL(absoluteUrl(value, base));
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^utm_/i.test(key) || /^(gclid|fbclid)$/i.test(key)) url.searchParams.delete(key);
  return url.href;
}
/** Configure once and share the same object between server and browser entries. */
export function defineSeo(config: SeoConfig): SeoConfig {
  const siteUrl = absoluteUrl(config.siteUrl, config.siteUrl);
  if (new URL(siteUrl).search || new URL(siteUrl).hash) throw new Error('KANSO_SEO_URL: siteUrl cannot contain a query or fragment.');
  return { ...config, siteUrl };
}
/** The caller supplies the loader type, just as with useLoaderData<T>(). */
export function defineRouteSeo<T>(resolver: (args: SeoResolverArgs<T>) => SeoMetadata): SeoResolver {
  return resolver as SeoResolver;
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
/** Undefined inherits, null clears, objects merge by field and arrays replace. */
export function mergeSeo(base: SeoMetadata, override: SeoMetadata): SeoMetadata {
  const merge = (a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> => {
    const result = { ...a };
    for (const [key, value] of Object.entries(b)) {
      if (value === undefined) continue;
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('KANSO_SEO_FIELD: invalid metadata field.');
      result[key] = record(value) && record(a[key]) ? merge(a[key], value) : value;
    }
    return result;
  };
  return merge(base as Record<string, unknown>, override as Record<string, unknown>) as SeoMetadata;
}
export function robotsContent(robots: RobotsMetadata | null | undefined, blocked = false): string {
  const values: string[] = [];
  if (blocked || robots?.index === false) values.push('noindex'); else if (robots?.index === true) values.push('index');
  if (robots?.follow != null) values.push(robots.follow ? 'follow' : 'nofollow');
  for (const key of ['noarchive', 'nosnippet', 'noimageindex'] as const) if (robots?.[key]) values.push(key);
  for (const [field, name] of [['maxSnippet', 'max-snippet'], ['maxVideoPreview', 'max-video-preview']] as const) {
    const value = robots?.[field];
    if (value != null) {
      if (!Number.isInteger(value) || value < -1) throw new Error(`KANSO_SEO_ROBOTS: invalid ${field}.`);
      values.push(`${name}:${value}`);
    }
  }
  if (robots?.maxImagePreview != null) {
    if (!['none', 'standard', 'large'].includes(robots.maxImagePreview)) throw new Error('KANSO_SEO_ROBOTS: invalid maxImagePreview.');
    values.push(`max-image-preview:${robots.maxImagePreview}`);
  }
  return values.join(', ');
}
/** Resolve one metadata tree to stable, serializable head descriptors. */
export function resolveSeo(config: SeoConfig, metadata: SeoMetadata, url: string): SeoSnapshot {
  const tags: HeadTag[] = [];
  const add = (key: string, tag: HeadTag['tag'], attrs: HeadTag['attrs'], text?: string) => tags.push({ key, tag, attrs, ...(text === undefined ? {} : { text }) });
  const meta = (name: string, value: unknown, property = false, key = name) => { if (value !== undefined && value !== null && value !== '') add(key, 'meta', { [property ? 'property' : 'name']: name, content: String(value) }); };
  const rawTitle = metadata.title === undefined ? config.defaultTitle : metadata.title;
  const absoluteTitle = typeof rawTitle === 'object' && rawTitle !== null;
  let title = typeof rawTitle === 'object' && rawTitle !== null ? rawTitle.absolute : rawTitle;
  if (title != null && !absoluteTitle && metadata.titleTemplate) title = metadata.titleTemplate.replaceAll('%s', title);
  if (title != null) add('title', 'title', {}, title);
  meta('description', metadata.description);
  const canonical = metadata.canonical === null ? undefined : metadata.canonical === undefined
    ? canonicalUrl(url, config.siteUrl) : absoluteUrl(metadata.canonical, config.siteUrl);
  if (canonical) add('canonical', 'link', { rel: 'canonical', href: canonical });
  const noindex = config.indexable === false || metadata.robots?.index === false;
  meta('robots', robotsContent(metadata.robots, config.indexable === false));
  const images = (input: SeoImageInput[] | null | undefined, prefix: 'og' | 'twitter') => {
    input?.forEach((item, index) => {
      const image = typeof item === 'string' ? { url: item } : item;
      meta(`${prefix}:image`, absoluteUrl(image.url, config.siteUrl), prefix === 'og', `${prefix}:image:${index}`);
      for (const field of (prefix === 'og' ? ['width', 'height', 'alt', 'type'] : ['alt']) as ('width' | 'height' | 'alt' | 'type')[]) {
        if ((field === 'width' || field === 'height') && image[field] != null && !(Number.isInteger(image[field]) && image[field]! > 0)) throw new Error(`KANSO_SEO_IMAGE: invalid ${field}.`);
        meta(`${prefix}:image:${field}`, image[field], prefix === 'og', `${prefix}:image:${index}:${field}`);
      }
    });
  };
  const fallback = metadata.image == null ? undefined : [metadata.image];
  const og = metadata.openGraph;
  if (og !== null) {
    meta('og:title', og?.title === undefined ? title : og.title, true);
    meta('og:description', og?.description === undefined ? metadata.description : og.description, true);
    meta('og:url', og?.url === undefined ? canonical : og.url === null ? null : absoluteUrl(og.url, config.siteUrl), true);
    meta('og:type', og?.type === undefined ? 'website' : og.type, true);
    meta('og:site_name', og?.siteName, true); meta('og:locale', og?.locale, true);
    images(og?.images === undefined ? fallback : og.images, 'og');
  }
  const twitter = metadata.twitter;
  if (twitter !== null) {
    const list = twitter?.images === undefined ? og?.images === undefined ? fallback : og.images : twitter.images;
    meta('twitter:card', twitter?.card === undefined ? list?.length ? 'summary_large_image' : 'summary' : twitter.card);
    meta('twitter:title', twitter?.title === undefined ? title : twitter.title);
    meta('twitter:description', twitter?.description === undefined ? metadata.description : twitter.description);
    meta('twitter:site', twitter?.site); meta('twitter:creator', twitter?.creator); images(list, 'twitter');
  }
  for (const [lang, href] of Object.entries(metadata.alternates ?? {})) {
    if (!/^(?:x-default|[a-z]{2,3}(?:-[a-z0-9]{2,8})*)$/i.test(lang)) throw new Error(`KANSO_SEO_LANGUAGE: invalid hreflang ${lang}.`);
    if (href !== null) add(`alternate:${lang}`, 'link', { rel: 'alternate', hreflang: lang, href: absoluteUrl(href, config.siteUrl) });
  }
  for (const [id, data] of Object.entries(metadata.jsonLd ?? {})) if (data !== null) {
    if (!id || !record(data) || !data['@type'] && !data['@graph']) throw new Error(`KANSO_SEO_JSON_LD: ${id} needs @type or @graph.`);
    const json = serialize(data);
    // JSON.stringify otherwise silently drops functions or converts non-finite numbers.
    JSON.stringify(data, (_key, value) => {
      if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'number' && !Number.isFinite(value)) throw new Error(`KANSO_SEO_JSON_LD: ${id} must be JSON data.`);
      return value;
    });
    add(`jsonld:${id}`, 'script', { type: 'application/ld+json' }, json);
  }
  if (metadata.dir != null && !['ltr', 'rtl', 'auto'].includes(metadata.dir)) throw new Error('KANSO_SEO_DIRECTION: expected ltr, rtl or auto.');
  return { url, tags, ...(metadata.lang == null ? {} : { lang: metadata.lang }), ...(metadata.dir == null ? {} : { dir: metadata.dir }), noindex };
}
export const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
export function renderHead(snapshot: SeoSnapshot): string {
  return snapshot.tags.map(tag => {
    const attrs = Object.entries({ 'data-kanso-head': tag.key, ...tag.attrs }).map(([key, value]) => ` ${key}="${escapeHtml(value)}"`).join('');
    const opening = `<${tag.tag}${attrs}>`;
    return ['title', 'script'].includes(tag.tag) ? `${opening}${tag.tag === 'script' ? tag.text ?? '' : escapeHtml(tag.text ?? '')}</${tag.tag}>` : opening;
  }).join('');
}

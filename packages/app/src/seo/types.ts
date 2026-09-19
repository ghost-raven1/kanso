import type { JSX } from 'solid-js';

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue | undefined };
export interface JsonLdData { '@context'?: string | Record<string, JsonValue>; '@type'?: string | string[]; '@graph'?: JsonLdData[]; [key: string]: JsonValue | undefined }
export interface SeoImage { url: string; width?: number; height?: number; alt?: string; type?: string }
export type SeoImageInput = string | SeoImage;
export interface RobotsMetadata {
  index?: boolean | null; follow?: boolean | null; noarchive?: boolean | null;
  nosnippet?: boolean | null; noimageindex?: boolean | null;
  maxSnippet?: number | null; maxVideoPreview?: number | null; maxImagePreview?: 'none' | 'standard' | 'large' | null;
}
export interface SocialMetadata {
  title?: string | null; description?: string | null; images?: SeoImageInput[] | null;
}
export interface SeoMetadata {
  title?: string | { absolute: string } | null; titleTemplate?: string | null;
  description?: string | null; canonical?: string | null; image?: SeoImageInput | null;
  lang?: string | null; dir?: 'ltr' | 'rtl' | 'auto' | null;
  robots?: RobotsMetadata | null;
  openGraph?: (SocialMetadata & { type?: string | null; url?: string | null; siteName?: string | null; locale?: string | null }) | null;
  twitter?: (SocialMetadata & { card?: 'summary' | 'summary_large_image' | null; site?: string | null; creator?: string | null }) | null;
  alternates?: Record<string, string | null> | null;
  jsonLd?: Record<string, JsonLdData | null> | null;
}
export interface SeoConfig extends SeoMetadata { siteUrl: string; defaultTitle?: string; indexable?: boolean }
export interface SeoResolverArgs<T = unknown> { data: T; params: Record<string, string>; url: URL }
export type SeoResolver = (args: SeoResolverArgs) => SeoMetadata;
export interface HeadTag { key: string; tag: 'title' | 'meta' | 'link' | 'script'; attrs: Record<string, string>; text?: string }
export interface SeoSnapshot { url: string; tags: HeadTag[]; lang?: string; dir?: string; noindex: boolean }
export interface SeoProviderProps { config: SeoConfig; url?: string; children?: JSX.Element }
export interface SitemapEntry { url: string; lastmod?: string | Date; alternates?: Record<string, string> }
export interface SitemapOptions {
  entries?: (args: { signal: AbortSignal }) => Iterable<SitemapEntry> | AsyncIterable<SitemapEntry> | Promise<Iterable<SitemapEntry> | AsyncIterable<SitemapEntry>>;
  ttlMs?: number;
}
export interface RobotsOptions {
  groups?: { userAgent: string | string[]; allow?: string[]; disallow?: string[] }[];
  sitemaps?: string[];
}

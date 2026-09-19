import type { JsonLdData, JsonValue } from './types.js';
interface Entity { name: string; url?: string; description?: string; image?: string | string[]; '@id'?: string }
const entity = (type: string, input: object): JsonLdData => ({ '@context': 'https://schema.org', '@type': type, ...input });
/** Preserve supplied facts; helpers never synthesize prices, ratings or dates. */
export const websiteJsonLd = (input: Entity): JsonLdData => entity('WebSite', input);
export const organizationJsonLd = (input: Entity & { logo?: string; sameAs?: string[] }): JsonLdData => entity('Organization', input);
export const articleJsonLd = (input: { headline: string; description?: string; image?: string | string[]; author?: JsonLdData | JsonLdData[]; datePublished?: string; dateModified?: string; url?: string; '@id'?: string }): JsonLdData => entity('Article', input);
export const productJsonLd = (input: Entity & { sku?: string; brand?: string | JsonLdData; offers?: JsonLdData | JsonLdData[]; aggregateRating?: JsonLdData; review?: JsonLdData[] }): JsonLdData => entity('Product', input);
/** Positions are derived from the explicit ordered breadcrumb list. */
export const breadcrumbJsonLd = (items: { name: string; url?: string }[]): JsonLdData => entity('BreadcrumbList', {
  itemListElement: items.map((item, index) => ({ '@type': 'ListItem', position: index + 1, name: item.name, ...(item.url ? { item: item.url } : {}) })) as JsonValue,
});

import { defineSeo, websiteJsonLd } from '@kanso/app/seo';

/** A deployment supplies its public origin at build time, shared by SSR and the client. */
export const seo = defineSeo({
  siteUrl: import.meta.env.VITE_SITE_URL ?? 'http://127.0.0.1:4173',
  lang: 'ru',
  defaultTitle: 'Kanso framework lab',
  titleTemplate: '%s · Kanso',
  description:
    'React-shaped TSX, Solid reactivity, server rendering and built-in SEO.',
  image: {
    url: '/og.png',
    width: 1280,
    height: 1440,
    alt: 'Kanso framework laboratory',
  },
  openGraph: { siteName: 'Kanso', locale: 'ru_RU' },
  jsonLd: { website: websiteJsonLd({ name: 'Kanso framework laboratory' }) },
});

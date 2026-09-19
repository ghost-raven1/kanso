import { defineSeo } from '@kanso/app/seo';
export const seo = defineSeo({
  siteUrl: import.meta.env.VITE_SITE_URL ?? 'http://127.0.0.1:4175',
  lang: 'ru',
  defaultTitle: 'Kanso studio',
  titleTemplate: '%s · Kanso studio',
  description:
    'Небольшая коллекция для рабочего стола. Демонстрация каталога и серверных форм Kanso.',
  image: '/product.svg',
});

import { defineSeo } from '@kanso/app/seo';
export const seo = defineSeo({
  siteUrl: 'http://127.0.0.1:4177',
  lang: 'ru',
  defaultTitle: 'Kanso microfrontends',
  titleTemplate: '%s · Kanso',
  description: 'Независимые микрофронты, единое приложение.',
});

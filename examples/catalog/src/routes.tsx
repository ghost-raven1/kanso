import { defineRoutes } from '@kanso/app';
import { Layout } from './pages/Layout';
import { Catalog } from './pages/Catalog';
import { Product } from './pages/Product';
import { Confirmation } from './pages/Confirmation';

export const routes = defineRoutes([
  {
    id: 'layout',
    path: '/',
    component: Layout,
    children: [
      {
        id: 'catalog',
        path: '/',
        component: Catalog,
        sitemap: true,
        seo: { title: 'Каталог' },
      },
      { id: 'product', path: '/products/:productId', component: Product },
      {
        id: 'confirmation',
        path: '/requests/:requestId',
        component: Confirmation,
        seo: { title: 'Заявка принята', robots: { index: false } },
      },
    ],
  },
]);

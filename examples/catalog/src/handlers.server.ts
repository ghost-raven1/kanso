import { defineRouteHandlers, redirect } from '@kanso/app/server';
import { routeUrl, type LoaderArgs } from '@kanso/app';
import { productJsonLd } from '@kanso/app/seo';
import { routes } from './routes';
import { products } from './catalog/products.server';
import {
  createDemoRequestStore,
  type RequestStore,
} from './catalog/requests.server';
import { seo } from './seo.config';

export function catalogLoader({ request }: LoaderArgs) {
  const url = new URL(request.url);
  const query = url.searchParams.get('q') ?? '';
  const category = url.searchParams.get('category') ?? '';
  const items = products.filter(
    product =>
      (!category || product.category === category) &&
      product.name
        .toLocaleLowerCase('ru')
        .includes(query.toLocaleLowerCase('ru')),
  );
  return { items, query, category };
}

export function productLoader({ params }: LoaderArgs) {
  const product = products.find(item => item.id === params.productId);
  if (!product) throw new Response('Товар не найден', { status: 404 });
  const canonical = new URL(
    routeUrl(routes, 'product', { productId: product.id }),
    seo.siteUrl,
  ).href;
  return {
    product,
    canonical,
    jsonLd: productJsonLd({
      name: product.name,
      description: product.summary,
      sku: product.id,
      url: canonical,
      image: new URL(product.image, seo.siteUrl).href,
    }),
  };
}

/** Inject a persistent store here without changing the page or form API. */
export function createHandlers(store: RequestStore = createDemoRequestStore()) {
  return defineRouteHandlers(routes, {
    catalog: { loader: catalogLoader },
    product: {
      loader: productLoader,
      action: async ({ request, params }) => {
        if (!products.some(product => product.id === params.productId))
          return new Response('Товар не найден', { status: 404 });
        const fields = await request.formData();
        const text = (key: string) =>
          typeof fields.get(key) === 'string'
            ? String(fields.get(key)).trim()
            : '';
        const values = {
          name: text('name'),
          email: text('email'),
          message: text('message'),
          interests: fields
            .getAll('interests')
            .filter(
              (value): value is string =>
                typeof value === 'string' &&
                ['details', 'availability'].includes(value),
            ),
        };
        const errors: Record<string, string> = {};
        if (values.name.length < 2)
          errors.name = 'Укажите имя: минимум два символа.';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email))
          errors.email = 'Укажите корректный email.';
        if (values.message.length < 10)
          errors.message = 'Добавьте немного деталей: минимум 10 символов.';
        if (Object.keys(errors).length)
          return { errors, values, formError: 'Проверьте выделенные поля.' };
        const saved = await store.save({
          ...values,
          productId: params.productId,
          intent: text('intent'),
        });
        return redirect(
          routeUrl(routes, 'confirmation', { requestId: saved.id }),
        );
      },
    },
    confirmation: {
      loader: async ({ params }) => {
        const record = await store.find(params.requestId);
        if (!record)
          throw new Response(
            'Заявка не найдена. Демонстрационное хранилище очищается при перезапуске.',
            { status: 404 },
          );
        // A public confirmation URL never reveals the applicant's contact details.
        return {
          requestId: record.id,
          productName:
            products.find(item => item.id === record.productId)?.name ?? '',
          intent: record.intent,
          interests: record.interests,
        };
      },
    },
  });
}

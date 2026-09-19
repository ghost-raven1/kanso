# SEO в Kanso 0.3

SEO задаётся общим конфигом, настройками маршрутов и JSX. Сервер отдаёт готовые метаданные без JavaScript; клиент принимает существующие теги и обновляет их при навигации. React Helmet и React runtime не используются.

## Общий конфиг

```tsx
// seo.config.ts — публичная конфигурация, одинаковая на сервере и клиенте
import { defineSeo } from '@kanso/app/seo';

export const seo = defineSeo({
  siteUrl: 'https://example.com',
  lang: 'ru',
  defaultTitle: 'Магазин',
  titleTemplate: '%s · Магазин',
  description: 'Каталог и условия доставки.',
  image: { url: '/share.jpg', width: 1200, height: 630, alt: 'Наш магазин' },
  openGraph: { siteName: 'Магазин', locale: 'ru_RU' },
});

// client.tsx
<App routes={routes} seo={seo} bootstrap={readBootstrap(document)} />;

// server.ts — внутри создания обработчика
createRequestHandler({ routes, handlers, seo, buildId, assets });
```

`siteUrl` — явный публичный URL HTTP(S), без query, fragment и credentials. Не подставляйте непроверенный Host заголовок. Для лаборатории используется `VITE_SITE_URL` при сборке; по умолчанию это `http://127.0.0.1:4173`. Vite dev работает на 5173, но проверка SEO должна выполняться против production SSR preview, а не CSR dev-shell.

Без маршрутизатора оберните приложение в `<SeoProvider config={seo}>`. Необязательный реактивный `url` задаёт текущий путь при собственной навигации; без него provider читает текущую локацию и события popstate. Изменение конфигурации сайта требует пересоздания provider, например через HMR.

## Страница и данные loader

```tsx
import { Seo, JsonLd, productJsonLd, defineRouteSeo } from '@kanso/app/seo';
import { useLoaderData } from '@kanso/app';

type Product = { name: string; description: string; image: string };

function ProductPage() {
  const product = useLoaderData<Product>();
  return <>
    <Seo title={product.name} description={product.description} image={product.image} />
    <JsonLd id="product" data={productJsonLd(product)} />
    <h1>{product.name}</h1>
  </>;
}

const productRoute = {
  id: 'product', path: '/products/:slug', component: ProductPage,
  seo: defineRouteSeo<Product>(({ data, params, url }) => ({
    title: data.name,
    description: data.description,
    canonical: `/products/${encodeURIComponent(params.slug)}`,
  })),
};
```

JSX и resolver — альтернативные или дополняющие способы. Обычно достаточно одного. Resolver синхронный и чистый; сеть и базы данных остаются в loader. Его `data` — результат loader этого route ID, `url` построен с публичным `siteUrl`. Generic задаётся автором, как в `useLoaderData<T>`; автоматического вывода типа из отдельной карты handlers нет.

Порядок наследования: сайт → layout → дочерние маршруты. На каждом уровне JSX выше route-конфига; дочерний route-конфиг выше JSX родителя. На одном уровне допускается один активный `<Seo>`. Несколько `<JsonLd>` разрешены с разными `id`; дочерний маршрут может переопределить блок родителя с тем же ID. После удаления владельца возвращается родительское значение.

`undefined` наследует, `null` удаляет, объекты объединяются по полям, массивы заменяются. Примеры:

```tsx
<Seo title={{ absolute: 'Заголовок без шаблона' }} description={null} />
<Seo openGraph={null} twitter={null} /> // отключить социальные теги
```

Шаблон применяется один раз. Title/description/image заполняют социальные теги; явные `openGraph` и `twitter` перекрывают соответствующие значения. OG images — массив строк или объектов `{ url, width, height, alt, type }`. Twitter поддерживает title, description, images, card, site, creator. `openGraph` дополнительно поддерживает type, url, siteName, locale.

## Canonical, языки и robots

Автоматический canonical сохраняет путь, регистр, завершающий слеш и смысловые query-параметры. Fragment, `utm_*`, `gclid`, `fbclid` удаляются. Явный canonical имеет приоритет и разрешается относительно `siteUrl`; `canonical: null` отключает тег. Ссылки страниц с пагинацией не сводятся автоматически к первой странице.

```tsx
<Seo
  lang="ru" dir="ltr"
  alternates={{ ru: '/ru/product', en: '/en/product', 'x-default': '/product' }}
  robots={{ index: true, follow: true, maxImagePreview: 'large' }}
/>
```

`alternates` задаёт hreflang, включая self-reference и x-default при необходимости. Указывайте взаимные альтернативы на переводах; маршрутизация и переводы не создаются автоматически. Также доступны robots.noarchive, nosnippet, noimageindex, maxSnippet и maxVideoPreview.

Общий `indexable: false` нельзя отменить на странице: HTML и HTTP X-Robots-Tag получают noindex, sitemap не публикуется. Это настройка индексирования, а не контроль доступа. Robots.txt задаёт обход отдельно; `Disallow` не заменяет noindex.

## Robots.txt и sitemap

```ts
// server entry / .server.ts — provider не импортируется клиентом
createRequestHandler({
  routes, handlers, seo, buildId, assets,
  robots: {
    groups: [{ userAgent: '*', allow: ['/'], disallow: ['/account'] }],
  },
  sitemap: {
    ttlMs: 300_000,
    entries: async ({ signal }) => {
      const products = await listPublicProducts({ signal });
      return products.map(product => ({
        url: `/products/${encodeURIComponent(product.slug)}`,
        lastmod: product.updatedAt,
        alternates: product.translations,
      }));
    },
  },
});
```

Статический route включается явно через `sitemap: true` или `sitemap: { lastmod, alternates }`. Обычные loaders при генерации sitemap не вызываются. Статически известные noindex-настройки исключаются; если индексируемость зависит от данных или JSX, provider должен включать только публичные индексируемые URL. SEO-аудит проверяет их фактические ответы.

Provider возвращает iterable/async iterable записей или Promise такого списка и получает AbortSignal. URL должны принадлежать origin сайта; языковые альтернативы могут ссылаться на другие домены. Дубли canonical URL устраняются, первая запись сохраняется. Lastmod используется только переданный автором, текущая дата вместо даты изменения не подставляется.

Кеш по умолчанию — пять минут с объединением одновременных запросов. Части ограничены 50 000 URL и 50 MiB несжатого UTF-8 XML. Для нескольких частей `/sitemap.xml` возвращает индекс с URL вида `/_kanso/sitemap/<generation>/<part>.xml`. Предыдущее поколение доступно до двух TTL с момента создания; поколения хранятся в памяти процесса. После рестарта индекс нужно получить заново. Для нескольких серверных процессов направляйте индекс и его части в один экземпляр или используйте общий внешний HTTP-кеш.

Robots.txt добавляет ссылку на sitemap автоматически. Дополнительные карты перечисляются в `robots.sitemaps`. GET и HEAD поддерживаются; отключённый sitemap возвращает 404. Ошибки и таймауты providers не публикуют частично собранное поколение.

## JSON-LD

`JsonLdData` принимает `@type`, `@graph` и JSON-совместимые свойства. Стабильный `id` определяет замену и очистку блока. Доступны `websiteJsonLd`, `organizationJsonLd`, `breadcrumbJsonLd`, `articleJsonLd`, `productJsonLd`. Helpers не создают вымышленные offers, рейтинги или даты. Breadcrumb positions выводятся из переданного порядка.

Данные проходят безопасную JSON-сериализацию: строка `</script>` не закрывает тег. Нельзя передавать функции, циклические объекты, BigInt и нечисловые значения Infinity/NaN. Проверка формата не означает подтверждение всех требований Google Rich Results; разметка должна соответствовать видимому содержимому.

## Проверка и переход с Helmet

```bash
kanso seo check --url http://localhost:4173 --json
kanso seo check --url https://example.com --max-pages 1000
```

CLI читает исходный HTML и sitemap, не выполняет JavaScript и не следует за внешними redirect. По умолчанию проверяются до 200 страниц и 200 sitemap-файлов того же origin. Частичный обход помечается `truncated` и предупреждением. Внешние origin пропускаются с предупреждением. URL с credentials не принимаются; сетевой таймаут — десять секунд.

Ошибки: дубли singleton-тегов, некорректные абсолютные URL, JSON-LD/XML, конфликтующие robots, неуспешные или перенаправляющие страницы в sitemap, noindex или другой canonical для перечисленного URL. Неполные метаданные и повторяющиеся заголовки — предупреждения. Exit codes: 0 — нет ошибок, 2 — найдены SEO-ошибки, 1 — команда не смогла выполниться. Отчёт содержит URL, поле, код и рекомендацию; балла «качества SEO» нет.

При переходе с Helmet замените provider на SeoProvider (либо App.seo), title/meta/link на поля Seo, JSON-LD scripts на JsonLd. Удалите старые title/canonical/description из index.html или пометьте соответствующими `data-kanso-head` ключами (`title`, `canonical`, `description`) для принятия существующих узлов. Неуправляемые теги Kanso не удаляет. Автоматического переноса произвольных Helmet-компонентов нет.

Лаборатория: `/seo`, `/seo/example/first`, `/seo/example/second`. `npm run test:seo` проверяет production HTML и exit codes; браузерные сценарии дополнительно проверяют гидратацию, реактивность, смену параметров и историю переходов.

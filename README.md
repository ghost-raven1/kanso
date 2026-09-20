# Kanso / 簡素

React-shaped TSX. Solid reactivity. No React runtime.

Рабочая реализация **0.10.0**: компилятор, ядро, Vite, мигратор, веб-слой с SSR и SEO, микрофронты, внешние stores и сервисы на приложение/SSR-запрос, необязательные инструменты Web/Service Workers. Пакеты пока не опубликованы. Поддерживаемый синтаксис и отличия исполнения зафиксированы в [спецификации](docs/semantics.md). Совместимость с React-зависимыми библиотеками не предоставляется.

```tsx
import { useState, useEffect } from '@kanso/core';

export function Counter() {
  const [count, setCount] = useState(0);
  const doubled = count * 2;

  useEffect(() => {
    document.title = `Счётчик: ${count}`;
  }, [count]);

  return (
    <button onClick={() => setCount(value => value + 1)}>
      {count} / {doubled}
    </button>
  );
}
```

Компилятор переписывает обращения к состоянию в чтения сигналов. Производное вычисление становится memo, JSX — привязками Solid. Тело `Counter` выполняется при создании экземпляра; клик обновляет зависимые значения и DOM.

## Пользовательские hooks

```tsx
// hooks/useCounter.ts
import { useState } from '@kanso/core';

export function useCounter(step = 1) {
  const [count, setCount] = useState(0);
  const doubled = count * 2;
  const increment = () => setCount(value => value + step);
  return { count, doubled, increment };
}

// Counter.tsx
import { useCounter } from './hooks/useCounter';

export function Counter() {
  const { count, doubled, increment } = useCounter();
  return <button onClick={increment}>{count} / {doubled}</button>;
}
```

Hook и компонент создаются один раз на экземпляр. Возвращаемые значения остаются реактивными через границу модуля; ручные accessor-функции в исходном коде не нужны. Изменяемые аргументы тоже остаются живыми. Hook и его потребители должны собираться одной версией компилятора Kanso.

## Stores и сервисы

`useStore(store, selector, equals?)` обновляет только зависимые значения. `defineService` и `useService` дают общий экземпляр внутри приложения и отдельный экземпляр на каждый SSR-запрос. App передаёт явные публичные снимки через гидратацию и навигацию. [API и пример](docs/services.md).

## Микрофронты в 0.6

Отдельно выпущенные Kanso-страницы и виджеты подключаются к общим Router, Context и SEO оболочки. Загрузка использует официальный Module Federation для Vite; SSR, loaders и actions выполняются в сервере оболочки. Runtime-версии проверяются до исполнения модуля, а его выпуск закрепляется для открытого документа.

```tsx
import { defineRemote } from '@kanso/microfrontends';
import type { Contract } from './remote-types/catalog';

export const catalog = defineRemote<Contract>({
  name: 'catalog',
  manifest: 'https://cdn.example.com/catalog/kanso-remote.json',
  contract: '^1.0.0',
});

const ProductCard = catalog.component('ProductCard');

export function Recommendations() {
  return <ProductCard productId="camera" />;
}
```

Передайте `[catalog]` в `App` и `createRequestHandler` через `microfrontends`. Серверные источники задаются отдельно через `remoteSources`. Типы создаёт сборка микрофронта; `kanso microfrontends sync` сохраняет их вместе с проверяемым lockfile. Полная настройка, предварительная загрузка, восстановление гидратации и откат описаны в [руководстве по микрофронтам](docs/microfrontends.md).

```bash
npm run dev:microfrontends
# SSR-оболочка: http://127.0.0.1:4177
# Отдельные каталог и виджет работают со своих origins.

npm run build:microfrontends
npm run preview:microfrontends
```

Шаблоны `microfrontends` и `remote` доступны в `kanso create`; команды `sync`, `check` и локальные переопределения описаны в [руководстве CLI](docs/microfrontends-cli.md). Приложения без микрофронтов не подключают federation runtime.

## Web Workers и Service Workers

`@kanso/workers` предоставляет типизированные фоновые задачи через `createWorker()` и `exposeWorker()`: отмену, передачу буферов и явное освобождение ресурсов. Native `new Worker(new URL(..., import.meta.url), { type: 'module' })` сохраняет настройки Vite и браузера. [Работа с Web Workers](docs/workers.md).

`@kanso/workers/service` регистрирует Service Worker по явному вызову и сообщает о доступном обновлении. `service-runtime` задаёт версию кеша, precache, правила статических ресурсов и offline fallback. Активация обновления управляется приложением; автоматической перезагрузки нет. HTML, loaders, actions и приватные ответы не попадают в кеш статических ресурсов. [Настройка Service Worker](docs/service-workers.md).

В демо микрофронтов есть фоновый поиск с прогрессом и отменой, а также панель регистрации и обновления Service Worker.

## Веб-приложения

Типизированные `routeUrl`, `RouteParams`, `LoaderData` и серверный `defineRouteHandlers` связывают маршруты, адреса и handlers. Формы работают в SSR без JavaScript: action возвращает ошибки и явно выбранные значения, а `redirect()` поддерживает POST/Redirect/GET. После клиентской отправки `pending` охватывает обновление loaders; `useRevalidator()` позволяет повторить только загрузку, сохранив уже выполненную запись.

[Руководство по данным и формам](docs/web-apps.md) · [исходники каталога](examples/catalog/README.md).

```bash
npm run build:catalog
npm run preview:catalog
# http://127.0.0.1:4175
```

Пример содержит URL-фильтры, карточку товара с SEO/JSON-LD, доступную форму заявки и подтверждение. Данные демонстрационные, заявки хранятся в памяти. Оплата и авторизация не входят в этот пример.

## Разработка в 0.4

Реактивный Context поддерживает замену primitive и объектов. Вложенная деструктуризация props и hooks, object/array rest и `useId` сохраняют привычную форму кода. Мигратор понимает стандартные aliases и показывает позиции ошибок в исходниках.

HMR сохраняет состояние при совместимых правках компонента и custom hooks; изменение структуры hooks вызывает явный сброс. Добавлены `kanso doctor` и SSR-шаблон с серверным HTML также в development.

[Руководство по разработке](docs/dx.md) · [миграция](docs/migration.md).

## SEO: конфиг и JSX

`@kanso/app/seo` управляет серверными и клиентскими метаданными: title/description, canonical, Open Graph, Twitter Cards, языки и JSON-LD. Общий конфиг передаётся в `App` и `createRequestHandler`; страница задаёт только отличия:

```tsx
import { Seo, JsonLd, productJsonLd } from '@kanso/app/seo';

<Seo title={product.name} description={product.description} image={product.image} />;
<JsonLd id="product" data={productJsonLd(product)} />;
```

Routes поддерживают SEO из loader и наследование от layouts. Сервер предоставляет robots.txt и sitemap с явным списком публичных страниц. `kanso seo check --url http://localhost:4173` проверяет исходный HTML и sitemap; ошибки блокируют проверку, рекомендации остаются предупреждениями.

[Руководство по SEO](docs/seo.md) · интерактивный пример `/seo` в лаборатории. Генератор изображений не требуется: укажите URL готовой картинки.

## Запуск

Node.js 20.19+ или 22.12+, npm, macOS/Linux. Проверено также в Linux с Node из официального образа Playwright.

```bash
npm ci
npm run build
npm run dev
```

Лаборатория содержит счётчик с пользовательским hook из отдельного файла, обновляемые props, список с сохранением состояния строк, lifecycle, серверную форму и lazy route.

Для production SSR:

```bash
npm run build:example
npm run preview
# http://127.0.0.1:4173
```

`build:example` использует один build ID для сервера и клиента. Он вычисляется из исходников, lockfile и настроек сборки. Начальные данные передаются в HTML и используются гидратацией без дополнительного loader-запроса.

## Пакеты

| Пакет | Ответственность |
| --- | --- |
| `@kanso/core` | Hooks, JSX-типы, stores и сервисы, Context, lazy, Suspense, ErrorBoundary; DOM lifecycle |
| `@kanso/compiler` | AST-преобразования привязок, props, производных значений, списков и событий; затем Solid JSX |
| `@kanso/vite` | Компиляция `.tsx`/`.jsx`/`.ts`, HMR, source maps, манифест и граница серверных модулей |
| `@kanso/app` | Solid Router, загрузка данных, actions, формы, буферизованный SSR, кеш и Node adapter |
| `@kanso/cli` | Создание проекта, проверка и атомарное применение поддерживаемой миграции |
| `@kanso/microfrontends` | Удалённые компоненты и маршруты, проверка контрактов, закрепление выпусков и подготовка гидратации |
| `@kanso/workers` | Типизированные Web Workers, управление Service Worker и настройка кеширования |

React, React DOM и React Compiler отсутствуют в workspace lockfile. Внешние эталоны benchmark устанавливаются отдельно в игнорируемую `output/benchmark/external-react`.

## Новый проект

До публикации пакетов используется локальный workspace:

```bash
node packages/cli/dist/bin.js create ../my-kanso-app --template csr --local "$PWD"
# Для SSR: --template ssr
cd ../my-kanso-app
npm install
npm run dev
```

CSR-шаблон включает TypeScript, Vite и пример компонента. SSR-шаблон добавляет маршруты, loader, SEO, гидратацию и Node server. Существующая непустая папка не перезаписывается.

## Миграция React + Vite

```bash
node packages/cli/dist/bin.js migrate --check --root ../my-react-app
node packages/cli/dist/bin.js migrate --apply --root ../my-react-app --local "$PWD"
```

После установки опубликованного CLI команды имеют форму `kanso migrate --check` и `kanso migrate --apply`.

Проверка обходит граф от entry в `index.html`, статические импорты, re-exports, literal dynamic imports и конфигурацию Vite. Проверяет установленные runtime-зависимости и их React peers. Неизвестные зависимости сначала нужно установить для аудита. В 0.7.2 проверенный vanilla entry пакета с optional React peer, например `zustand/vanilla`, проходит проверку; React entry того же пакета остаётся ошибкой.

Применение меняет импорты, поддерживаемые типы, клиентский entry, Vite, TypeScript и package.json. Повторный запуск не создаёт новых изменений. При блокирующей диагностике ни один файл приложения не записывается. Lockfile обновляется последующим `npm install`, затем следует выполнить проверки самого приложения.

Подробнее: [границы миграции](docs/migration.md) и [следующие этапы подготовки](docs/migration-readiness.md). В 0.6.1 доступны несколько `--entry`/`--config`, аудит переэкспортов Vite и отчёт охвата графа. MUI, Ant Design, React Router, Next.js и другие React-зависимые библиотеки автоматически не переносятся.

## Веб-приложение

Маршруты доступны серверу и клиенту; handlers импортируются только сервером:

```tsx
// routes.tsx
import { defineRoutes, useLoaderData } from '@kanso/app';

function Profile() {
  const { name } = useLoaderData<{ name: string }>();
  return <h1>{name}</h1>;
}

export const routes = defineRoutes([
  { id: 'profile', path: '/people/:id', component: Profile },
]);
```

```ts
// handlers.server.ts
import type { RouteHandlers } from '@kanso/app';

export const handlers: Record<string, RouteHandlers> = {
  profile: {
    loader: ({ params, signal }) =>
      fetch(`https://example.test/people/${params.id}`, { signal }).then(r => r.json()),
  },
};
```

```ts
// server.ts — server entry
import { createRequestHandler } from '@kanso/app/server';
import { routes } from './routes';
import { handlers } from './handlers.server';

export const handle = createRequestHandler({
  routes, handlers,
  buildId: manifest.buildId,
  assets: { entry: manifest.entries[0], styles: manifest.styles },
  context: request => ({ requestId: crypto.randomUUID() }),
});
```

`manifest` — прочитанный сервером `kanso-manifest.json` из клиентской сборки. Node.js-адаптер экспортируется как `nodeHandler` из `@kanso/app/node`.

Рабочие client/server entry и форма находятся в `examples/lab`. Прикладное хранилище имени в лаборатории живёт в памяти процесса только для демонстрации; в приложении его заменяет БД. Состояние рендера и loader snapshots создаются отдельно для каждого запроса.

## Проверки

```bash
npm run check             # пакеты, TypeScript, Vitest, production SSR, dependency audit
npx playwright install chromium firefox webkit
npm run test:browser      # SSR/hydration, ввод, DOM identity, формы, список, lazy, mobile
npm run test:services     # packed Zustand vanilla, SSR, селекторы и cleanup
npm run test:compatibility # key reset, raw HTML, SSR/hydration и cleanup
npm run test:seo          # production HTML, sitemap и exit codes диагностики
npm run test:tooling      # настоящая миграция, npm install, build, HMR, server-only boundary
npm run test:hmr          # состояние, refs, IDs, cleanup, Context, reset и ошибки HMR
npm run test:dx           # три приложения до/после миграции, tarballs, doctor, CSR/SSR
npm run test:web          # типы маршрутов, native/enhanced формы и каталог
npm run test:workers      # packed Web Worker: отмена, перенос буферов, cleanup
npm run test:service-workers # регистрация, обновления и versioned cache
npm run test:microfrontends-dx # packed шаблоны, SSR и разделение артефактов
npm run test:microfrontends-dev # SSR development, remote HMR и сброс границ
npm run test:microfrontends # независимые сборки, SSR, версии и браузерные переходы
npm run bench            # production Kanso/Solid/React/memo/React Compiler
```

Тесты исполняют собранные пакеты. После изменения исходников перед отдельным `npm test` нужно выполнить `npm run build`; `npm run check` делает это автоматически.

Linux-проверка всех браузеров, в том числе при проблеме запуска Firefox на macOS 27:

```bash
docker build -f Dockerfile.test -t kanso-test:0.10.0 .
mkdir -p output/linux
docker run --rm --mount "type=bind,source=$PWD/output/linux,target=/results" kanso-test:0.10.0
```

Результаты и скриншоты сохраняются в `output/`. Исходные условия и результаты замеров — в [отчёте](docs/validation.md). CI описан в `.github/workflows/ci.yml`.

## Границы первой версии

Поддерживаются функциональные компоненты, именованные props и rest, keyed JSX map, терминальные return-ветви, перечисленные hooks и собственный веб-слой. Неоднозначные конструкции завершают компиляцию адресной диагностикой.

Пользовательские `useX` поддерживают живые аргументы и возврат значения, объекта или tuple через отдельные `.ts`/`.js`-модули, именованные импорты и переэкспорты. Мигратор проверяет локальную реализацию до записи; неизвестные внешние hooks требуют порта. Поддержаны вложенные параметры и результаты, defaults, object/array rest и один терминальный return. Variadic-параметры и вычисляемые ключи диагностируются. Context обновляет потребителей при изменении Provider.value.

Streaming SSR, RSC, перенос Next.js, React-библиотек и все особенности React event/concurrent runtime не входят в эту версию. HMR сохраняет состояние совместимых границ; при изменении структуры hooks выполняется сброс. DOM и фокус внутри заменяемого компонента могут пересоздаваться.

### Если локальный адрес показывает другое приложение

Service Worker привязан к origin и может пережить смену проекта на том же порту. Проверяйте preview в обычном браузере, а не только в чистом тестовом профиле. Для независимого адреса лаборатории:

```bash
VITE_SITE_URL=http://127.0.0.1:4180 npm run build:example
PORT=4180 npm run preview
```

Откройте `http://127.0.0.1:4180/`. Предварительно проверьте, что порт свободен. Данные и регистрации других приложений автоматически не удаляются.

В 0.9.0 добавлены [Portal](docs/portals.md), [тестовый API и конфигурация Vitest](docs/testing.md), [читаемая диагностика CLI](docs/logging.md). В лаборатории **Lifecycle & portals** доступны refs, списки и немодальная панель с общим Context.

В 0.10.0 добавлен [Dialog](docs/dialogs.md): вложенные модальные окна, управление закрытием, фокусом и прокруткой, собственные стили. [Защита серверного транспорта](docs/security.md) включает проверку источника actions, лимит POST, разделение HTML-кеша по origin и проверку redirect URL. При обновлении существующего приложения проверьте upload-лимит, cookie POST без Origin и override зависимости, описанные в руководстве.

[Lazy-компоненты](docs/lazy.md) поддерживают страницы и загрузку интерактивных блоков по взаимодействию с лёгкой оболочкой; все fallback настраиваются. [useTransition](docs/transitions.md) ожидает готовность нового UI и поддерживает кастомные keyframes. Примеры доступны в разделе **Lazy route** лаборатории.

[Критерии готовности 1.0](docs/migration-readiness.md#условия-готовности-10) относятся к возможностям фреймворка. Перенос конкретного приложения выполняется отдельно; оставшиеся UI, navigation, form и integration-контракты перечислены явно.

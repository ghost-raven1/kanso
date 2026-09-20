# Микрофронты Kanso 0.6

Страницы и виджеты собираются и выпускаются отдельно, но входят в одно дерево
Solid. Оболочка владеет Router, Context и реестром SEO; её сервер выполняет SSR,
loaders и actions. Поддерживаются доверенные Kanso-модули. Код загружается через
официальные пакеты Module Federation для Vite, без React runtime или iframe.

## Подключение компонента

Сначала получите сгенерированные типы командой
`kanso microfrontends sync`. Сохраните `remote-types/` и
`kanso-remotes.lock.json` в репозитории оболочки. Сборка использует локальные типы;
загрузка нового контракта всегда явная. Формат конфигурации и диагностики описаны
в [руководстве CLI](microfrontends-cli.md).

```tsx
// remotes.ts
import { defineRemote } from '@kanso/microfrontends';
import type { Contract } from './remote-types/catalog';

export const catalog = defineRemote<Contract>({
  name: 'catalog',
  manifest: 'https://cdn.example.com/catalog/kanso-remote.json',
  contract: '^1.0.0',
});

export const microfrontends = [catalog];

// Recommendations.tsx
const ProductCard = catalog.component('ProductCard', {
  pending: () => <p>Загружаем карточку…</p>,
  error: ({ retry }) => (
    <button onClick={retry}>Повторить загрузку карточки</button>
  ),
});

export function Recommendations() {
  return <ProductCard productId="camera" />;
}
```

Описание и вызов `.component()` сами не загружают код. Props и callbacks передаются
как обычному компоненту. Несколько экземпляров имеют отдельных владельцев и
состояние. При ошибке после гидратации fallback ограничивается границей виджета.
Настройка `ssr: false` оставляет `pending` на сервере и запускает загрузку после
монтирования в браузере; по умолчанию SSR включён.

Передайте один список описаний в `App` и `createRequestHandler` через
`microfrontends`. Для виджетов без маршрутизатора доступен
`<MicrofrontendProvider remotes={microfrontends}>`. Каждый provider создаёт
собственную сессию и освобождает её при удалении.

## Сборка существующего раздела

Экспортируемый компонент остаётся обычным TSX-модулем с default export:

```ts
// vite.config.ts микрофронта
import { defineConfig } from 'vite';
import kanso from '@kanso/vite';

const buildId = process.env.KANSO_BUILD_ID;
if (!buildId) throw new Error('Set KANSO_BUILD_ID for this release');

export default defineConfig(({ isSsrBuild }) => ({
  base: `${isSsrBuild
    ? 'https://internal.example.com/catalog'
    : 'https://cdn.example.com/catalog'}/releases/${buildId}/`,
  plugins: [
    kanso({
      buildId,
      microfrontends: {
        name: 'catalog',
        contract: '1.0.0',
        exposes: { ProductCard: './src/ProductCard.tsx' },
        routes: './src/routes.tsx',
        server: './src/handlers.server.ts',
      },
    }),
  ],
}));
```

`routes` экспортирует именованный `routes`, `server` — именованный `handlers`.
Для микрофронта только с виджетами эти два поля не нужны. Сборка создаёт
`kanso-remote.json`, клиентские чанки и `types.json` с декларациями; SSR-сборка
создаёт отдельный `kanso-server.json` и серверные чанки. Приватный каталог не
должен раздаваться клиентским HTTP-сервером.

Kanso настраивает общие экземпляры Solid, Router и Kanso, включая используемые
subpath imports. Их версии должны совпадать точно. Совместимый диапазон
`contract` относится к API микрофронта, а не к версии runtime. Несоответствие
диагностируется до исполнения удалённого кода.

Компоненты и hooks компилируются Kanso своей сборки. CSS Modules получают имена
с префиксом микрофронта; тему удобно передавать через CSS-переменные оболочки.
Глобальные CSS-селекторы сохраняют обычную область действия документа.

## Общие данные и Context

Передавайте данные через props и изменения через callbacks. Объект Context,
созданный оболочкой, можно передать в props; удалённый компонент прочитает его
обычным `useContext`. В примере каталога это демонстрирует настройка шага.

Если обе стороны импортируют Context из контрактного пакета, добавьте этот пакет
в `microfrontends.shared` Vite как `{ '@company/contracts': '1.2.0' }` и в
описание remote как
`shared: { '@company/contracts': { version: '1.2.0', module: contracts } }`, где
`contracts` — namespace import установленного модуля. Точное совпадение версии
и единственный экземпляр сохраняют идентичность Context.

Пользовательские значения Context и сервисы создаются оболочкой на каждый SSR-
запрос. Не храните данные запроса в модульных переменных удалённого компонента:
исполняемый код может переиспользоваться между запросами.

## Маршруты, формы и SEO

```tsx
import { defineRoutes } from '@kanso/app';
import { catalog } from './remotes';

export const routes = defineRoutes([
  { id: 'home', path: '/', component: Home },
  catalog.routes({ path: '/catalog' }),
]);
```

Точка подключения — абсолютный статический путь. ID локальных маршрутов получают
пространство имён микрофронта. Внутри раздела используйте
`const url = useRouteUrl(routes)` и `url('product', { id: 'camera' })`: ссылка
учитывает `/catalog`. Обычный `routeUrl()` сохраняет прежний контракт.

`useLoaderData`, `useForm`, `Form`, redirects и native POST используют оболочку.
Сервер получает приватный entry только из своих настроек:

```ts
createRequestHandler({
  routes,
  seo,
  microfrontends,
  buildId: manifest.buildId,
  assets: { entry: manifest.entries[0], styles: manifest.styles },
  remoteSources: {
    catalog: {
      manifest:
        'https://internal.example.com/catalog/releases/{buildId}/kanso-server.json',
    },
  },
});
```

Клиент не выбирает адрес исполняемого серверного кода. Его переданная идентичность
проверяется и разрешается относительно настроенных источников.

`Route.seo`, `<Seo>` и `<JsonLd>` входят в общий реестр и наследование оболочки.
Публичные маршруты с `Route.sitemap` участвуют в её sitemap. CSS и preload
использованных модулей попадают в исходный HTML. Ошибка обязательного remote
приводит к HTTP `503`, таймаут — к `504`; такой ответ не помещается в HTML-кеш.

## Подготовка гидратации

SSR использует один корень гидратации. Перед `hydrateRoot` загрузите все модули,
которые сервер записал в bootstrap:

```tsx
import { App, readBootstrap } from '@kanso/app';
import { hydrateRoot, mount } from '@kanso/core/client';
import { prepareMicrofrontends } from '@kanso/microfrontends';

async function start() {
  const bootstrap = readBootstrap(document, HOST_BUILD_ID);
  const session = await prepareMicrofrontends(microfrontends, bootstrap, routes);
  const render = () => (
    <App
      routes={routes}
      seo={seo}
      bootstrap={bootstrap}
      microfrontends={microfrontends}
      microfrontendSession={session}
    />
  );
  const root = document.getElementById('root')!;
  const unmount = bootstrap ? hydrateRoot(render, root) : mount(render, root);

  return () => {
    unmount();
    session.dispose();
  };
}
```

`HOST_BUILD_ID` должен совпадать с идентичностью клиентской сборки оболочки.
Обработайте отклонение `start()` с кнопкой повторной попытки вне корня SSR:
пример находится в `examples/microfrontends/host/src/main.tsx`.
Пока необходимые модули недоступны, серверный DOM остаётся на месте;
интерактивность всего корня ожидает загрузки. Initial loaders после успешной
гидратации не запрашиваются повторно.

Для предварительной загрузки без монтирования вызовите
`await catalog.preload(session)`. Метод проверяет manifest и загружает его
экспорты в указанную сессию. Если вызов происходит синхронно под provider,
аргумент можно опустить; вне владельца, в том числе в обработчике браузерного
события, передавайте сессию явно.

## Независимый выпуск и откат

1. Выберите уникальный `buildId` и соберите клиентские и серверные файлы с ним.
2. Опубликуйте оба неизменяемых каталога `/releases/<buildId>/`, включая их
   manifests и декларации. Существующий адрес не должен менять содержимое.
3. Проверьте новый выпуск в staging-окружении с его текущим указателем и
   конфигурацией `kanso.microfrontends.json`: `kanso microfrontends check --json`.
4. После доступности всех файлов обновите production-указатель `kanso-remote.json`
   и повторите проверку для production-конфигурации. Команда проверяет выпуск,
   на который указывает настроенный manifest; до переключения это прежний выпуск.

Оболочка без пересборки узнаёт новый выпуск при первом обращении к remote в
новой сессии. При первом использовании выпуск закрепляется до закрытия документа.
Bootstrap передаёт эту идентичность браузеру; навигация, loaders, enhanced и
native формы продолжают использовать её. Удаление секции очищает её эффекты,
но не переключает выпуск в открытом документе.

Откат меняет текущий manifest обратно на сохранённый выпуск. Старые открытые
документы остаются на своих версиях. Храните клиентские и приватные артефакты всех
поддерживаемых открытых документов; HTML-кеш учитывает закреплённые выпуски.
Недоступный закреплённый выпуск требует обновления документа (`409`), а не
автоматического выполнения action из другого выпуска.

Текущие manifests должны доходить до сервера/CDN с подходящей политикой обновления.
Service Worker может кешировать неизменяемые URL ресурсов, но не должен подменять
manifest или ответ формы. [Управление Service Worker](service-workers.md)
сохраняет полные URL, раздельные версии кеша и явную активацию без перезагрузки.

## Локальное окружение

```bash
kanso create my-platform --template microfrontends
kanso create catalog --template remote
```

До npm-публикации передавайте `--local /absolute/path/to/kanso` после сборки
пакетов. Полный шаблон включает SSR-оболочку, каталог и отдельный виджет; одна
команда `npm run dev` запускает окружение. У каждого remote есть собственные
`dev`, `build`, `preview` и `typecheck`.

В примере адреса браузерных модулей переопределяются через
`VITE_CATALOG_ORIGIN` и `VITE_PROMOTION_ORIGIN`; приватные источники — через
`KANSO_CATALOG_SERVER_ORIGIN` и `KANSO_PROMOTION_SERVER_ORIGIN`.
Чтобы запустить только каталог локально, задайте `KANSO_LOCAL_REMOTES=catalog`;
для остальных микрофронтов укажите опубликованные публичные и приватные origins.
Например, из корня шаблона:

```bash
KANSO_LOCAL_REMOTES=catalog \
  VITE_PROMOTION_ORIGIN=https://cdn.example.com/promotion \
  KANSO_PROMOTION_SERVER_ORIGIN=https://internal.example.com/promotion \
  npm run dev
```

По умолчанию запускаются оба локальных микрофронта. В исходном репозитории команда
окружения — `npm run dev:microfrontends`; шаблон использует `npm run dev`.

Совместимые обновления компонентов используют границы HMR Kanso. Изменение
сигнатуры hooks сбрасывает затронутую границу; изменение экспортов или маршрутов
требует новой загрузки документа. Ошибка компиляции оставляет последнюю рабочую
страницу. HMR runtime отсутствует в production и SSR.

## Проверки

`test:microfrontends` проверяет реальные независимые сборки и браузерный жизненный
цикл. `test:microfrontends-dx` устанавливает упакованные пакеты вне workspace и
проверяет шаблоны. Unit-контракты находятся в
`tests/microfrontends-contracts.test.ts`; CI запускает Chromium, Firefox и WebKit.
Результат отдельного локального запуска не означает завершённый выпуск или
успешный CI.

Для вычислений вне основного потока используйте отдельный необязательный пакет
[Web Workers](workers.md). Он не подключает federation runtime; приложение без
микрофронтов сохраняет прежний граф выполнения.

## Документ после смены runtime

Совместимые независимые выпуски remote продолжают использовать закреплённые версии. При смене общей runtime-версии старый документ может потребовать обновления. Data transport сохраняет код ошибки и показывает кнопку перезагрузки; компонентная граница также предлагает обновление при несовместимом runtime/shared контракте.

Новые документы передают build ID оболочки в data requests и native/enhanced forms. Сервер отклоняет несовпадающий ID до loaders/actions: `409`, `Cache-Control: no-store`, `X-Kanso-Recovery: reload`. Enhanced form сохраняет ввод и сообщает о необходимости обновления. Автоматического reload или повторного POST нет. Перед ручной перезагрузкой сохраните незавершённый ввод. Клиенты старых версий, ещё не передающие build ID, защищены проверками закреплённых remote/runtime; полного сохранения старого runtime на новом сервере этот механизм не обещает.

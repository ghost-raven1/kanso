# Kanso / 簡素

React-shaped TSX. Solid reactivity. No React runtime.

Рабочая реализация **0.2.0**: компилятор, ядро, Vite, мигратор и веб-слой с SSR. Пакеты пока не опубликованы. Поддерживаемый синтаксис и отличия исполнения зафиксированы в [спецификации](docs/semantics.md). Это ограниченная первая версия, а не совместимый со всей экосистемой React runtime.

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
| `@kanso/core` | Hooks, JSX-типы, store, Context, lazy, Suspense, ErrorBoundary; DOM lifecycle |
| `@kanso/compiler` | AST-преобразования привязок, props, производных значений, списков и событий; затем Solid JSX |
| `@kanso/vite` | Компиляция `.tsx`/`.jsx`/`.ts`, HMR, source maps, манифест и граница серверных модулей |
| `@kanso/app` | Solid Router, загрузка данных, actions, формы, буферизованный SSR, кеш и Node adapter |
| `@kanso/cli` | Создание проекта, проверка и атомарное применение поддерживаемой миграции |

React, React DOM и React Compiler отсутствуют в workspace lockfile. Внешние эталоны benchmark устанавливаются отдельно в игнорируемую `output/benchmark/external-react`.

## Новый проект

До публикации пакетов используется локальный workspace:

```bash
node packages/cli/dist/bin.js create ../my-kanso-app --local "$PWD"
cd ../my-kanso-app
npm install
npm run dev
```

Сгенерированный проект включает TypeScript, Vite и пример компонента. Существующая непустая папка не перезаписывается.

## Миграция React + Vite

```bash
node packages/cli/dist/bin.js migrate --check --root ../my-react-app
node packages/cli/dist/bin.js migrate --apply --root ../my-react-app --local "$PWD"
```

После установки опубликованного CLI команды имеют форму `kanso migrate --check` и `kanso migrate --apply`.

Проверка обходит граф от entry в `index.html`, статические импорты, re-exports, literal dynamic imports и конфигурацию Vite. Проверяет установленные runtime-зависимости и их React peers. Неизвестные зависимости сначала нужно установить для аудита.

Применение меняет импорты, поддерживаемые типы, клиентский entry, Vite, TypeScript и package.json. Повторный запуск не создаёт новых изменений. При блокирующей диагностике ни один файл приложения не записывается. Lockfile обновляется последующим `npm install`, затем следует выполнить проверки самого приложения.

Подробнее: [границы миграции](docs/migration.md). MUI, Ant Design, React Router, Next.js и другие React-зависимые библиотеки автоматически не переносятся.

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
npm run test:tooling      # настоящая миграция, npm install, build, HMR, server-only boundary
npm run bench            # production Kanso/Solid/React/memo/React Compiler
```

Тесты исполняют собранные пакеты. После изменения исходников перед отдельным `npm test` нужно выполнить `npm run build`; `npm run check` делает это автоматически.

Linux-проверка всех браузеров, в том числе при проблеме запуска Firefox на macOS 27:

```bash
docker build -f Dockerfile.test -t kanso-test:0.2.0 .
mkdir -p output/linux
docker run --rm --mount "type=bind,source=$PWD/output/linux,target=/results" kanso-test:0.2.0
```

Результаты и скриншоты сохраняются в `output/`. Исходные условия и результаты замеров — в [отчёте](docs/validation.md). CI описан в `.github/workflows/ci.yml`.

## Границы первой версии

Поддерживаются функциональные компоненты, именованные props и rest, keyed JSX map, терминальные return-ветви, перечисленные hooks и собственный веб-слой. Неоднозначные конструкции завершают компиляцию адресной диагностикой.

Пользовательские `useX` поддерживают живые аргументы и возврат значения, объекта или tuple через отдельные `.ts`/`.js`-модули, именованные импорты и переэкспорты. Мигратор проверяет локальную реализацию до записи; неизвестные внешние hooks требуют порта. Поддержаны именованные параметры, плоская деструктуризация результата и один терминальный return; остальные формы получают диагностику. Context предназначен для передачи сервисов и реактивных объектов/store.

Streaming SSR, RSC, перенос Next.js, React-библиотек и все особенности React event/concurrent runtime не входят в эту версию. HMR обновляет компоненты; сохранение локального состояния при замене их реализации не гарантируется.

# Внешние stores и сервисы

В Kanso 0.7 `useStore` подписывает компонент на выбранную часть внешнего store. `defineService` создаёт его отдельно для каждого приложения и SSR-запроса. API экспортируется из `@kanso/core`; существующий `createStore` сохраняет контракт Solid.

## Подключение store

```tsx
import { useStore } from '@kanso/core';

function Counter({ store }: { store: CounterStore }) {
  const count = useStore(store, state => state.count);

  return (
    <button onClick={() => store.setState({ count: count + 1 })}>
      {count}
    </button>
  );
}
```

Store предоставляет `getState(): T` и `subscribe(listener): unsubscribe`. Поддерживается, например, `createStore` из `zustand/vanilla`; пакет устанавливается приложением. Никакой React binding не нужен. Без selector hook возвращает весь snapshot.

Selector получает типизированное состояние. Результат сравнивается через `Object.is`; третий аргумент задаёт собственный equality. Замена store prop снимает старую подписку. Изменение реактивных значений, захваченных selector, пересчитывает результат. Деструктуризация результата остаётся реактивной; тело компонента повторно не исполняется.

Обновляйте state неизменяемо и уведомляйте подписчиков. Мутация объекта без уведомления не становится реактивной автоматически. Selectors и equality должны быть чистыми. Hook вызывается на верхнем уровне компонента или скомпилированного custom hook; внутри обработчика обычный `const snapshot = count` сохраняет снимок.

На сервере подписок нет. Необязательный `getServerSnapshot()` задаёт значение для SSR и первого прохода гидратации; после монтирования читается `getState()`. Если метода нет, сервер и клиент должны иметь одинаковое начальное состояние. Для этого удобно передавать снимок через сервис.

## Один сервис на приложение или запрос

```ts
// services/settings.ts — общий модуль клиента и сервера
import { createStore } from 'zustand/vanilla';
import { defineService } from '@kanso/core';

interface Settings { theme: 'light' | 'dark'; count: number }

function makeSettings(initial: Settings) {
  return createStore<Settings>(() => initial);
}

export const settings = defineService<ReturnType<typeof makeSettings>, Settings>({
  id: 'settings',
  create: ({ snapshot }) => makeSettings(snapshot ?? { theme: 'light', count: 0 }),
  snapshot: store => store.getState(),
  restore: (store, snapshot) => store.setState(snapshot, true),
});
```

```tsx
import { useService, useStore } from '@kanso/core';
import { settings } from './services/settings';

export function ThemeButton() {
  const store = useService(settings);
  const theme = useStore(store, state => state.theme);

  return (
    <button onClick={() => store.setState({ theme: theme === 'light' ? 'dark' : 'light' })}>
      Theme: {theme}
    </button>
  );
}
```

`App` автоматически подключает provider. Loader и action получают тот же scope в аргументе `services`:

```ts
// handlers.server.ts
import { settings } from './services/settings';

export const handlers = {
  home: {
    loader: async ({ services, request, signal }) => {
      const preferences = await readPreferences(request, signal);
      services.get(settings).setState(preferences);
      return {};
    },
  },
};
```

Фабрика синхронная и вызывается лениво, один раз на scope. Асинхронные методы и незавершённые Promise могут находиться внутри возвращаемого экземпляра. `get(otherDefinition)` создаёт зависимый сервис; циклы и разные definitions с одинаковым ID диагностируются. В микрофронтах модуль определений подключается как shared contract: копировать definition с тем же ID нельзя.

Каждый SSR-запрос получает новый scope. Native action, последующие loaders и SSR используют его вместе. После ответа, redirect, ошибки или отмены scope освобождается. Вложенные loaders могут выполняться параллельно; порядок записи общего состояния определяет приложение. Не размещайте пользовательский store или Promise в module scope серверного модуля.

## Снимки, навигация и очистка

Пара `snapshot` / `restore` явно разрешает передачу публичных данных. Без неё сервис остаётся локальным и не сериализуется. Снимок содержит только JSON: конечные числа, строки, boolean, null, массивы и простые объекты. Методы, undefined, Date, Map, циклы и BigInt отклоняются. Не включайте секреты, токены и соединения. В публичный HTML-кеш попадёт и публичный снимок, поэтому персональные маршруты не объявляют `cache.public`.

SSR собирает снимки после завершения lazy-рендера и безопасно помещает их в bootstrap. Клиент создаёт сервисы из этих данных без повторного initial loader. При принятой навигации или revalidation `restore` обновляет уже созданный экземпляр, сохраняя его идентичность; для ещё не созданных сервисов сохраняется seed. Отсутствующий в ответе ID оставляет прежнее состояние. Устаревшие ответы не применяются. Серверные snapshots не являются механизмом сохранения данных между запросами: постоянное хранение выполняет приложение.

Фабрика получает `signal` и `onCleanup`. Передавайте signal асинхронной работе; callback освобождает сокеты, таймеры и другие ресурсы. Scope сначала отменяет signal, затем очищает сервисы в обратном порядке создания, включая зависимости. Callback очистки синхронный. Ошибка одного callback не мешает остальным; ошибки агрегируются. После disposal новые обращения запрещены. Отмена кооперативная: метод должен проверять signal перед записью результата.

При удалении компонента `useStore` автоматически отписывается, а общий сервис остаётся до удаления приложения. Совместимое HMR-обновление потребителя пересоздаёт его подписки и сохраняет сервис в существующем scope. Перезагрузка модуля, создающего scope, или всего документа может сбросить его; восстановление произвольных сервисов через HMR не обещается.

## Без маршрутизатора и вложенные области

```tsx
import { createServiceScope, ServiceProvider } from '@kanso/core';
import { mount } from '@kanso/core/client';

const scope = createServiceScope();
const unmount = mount(
  () => <ServiceProvider scope={scope}><ThemeButton /></ServiceProvider>,
  document.getElementById('root')!,
);

function dispose() {
  try { unmount(); } finally { scope.dispose(); }
}
```

`ServiceProvider` и `App services={scope}` заимствуют scope: освобождает его создатель. Вложенный provider задаёт независимую область, ближайшую к потребителю. Передавайте стабильный scope; для смены пользователя размонтируйте область, освободите её и создайте новую. Без явного `services` App сам владеет своей областью и очищает её.

## Проверка и границы миграции

`npm run test:services` упаковывает Kanso, устанавливает пакеты и настоящий `zustand/vanilla` в отдельный проект вне workspace, запускает TypeScript, production SSR и браузерные сценарии. Проверяются initial snapshot, сохранение DOM/ввода при гидратации, селекторы, back/forward, revalidation, поздние ответы и cleanup. Этот сценарий также входит в `npm run test:compatibility`, которую выполняет CI. В лаборатории пример доступен по `/services/alpha`.

Автоматическая замена Zustand React hooks не реализована. Начиная с 0.7.2 `migrate` и `doctor` проверяют runtime-граф используемого entry пакета с optional React peer. Проверенный `zustand/vanilla` проходит аудит; корневой `zustand` с React hooks остаётся ошибкой. [Правила и ограничения проверки](migration.md#vanilla-dependencies).

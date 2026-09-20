# Тестирование компонентов

`@kanso/core/testing` даёт `render`, `renderComponent` и `createTestScope`.
Обновление props сохраняет экземпляр компонента. React `act` и повторное
исполнение тела компонента не имитируются. Пакет не содержит query-библиотеку:
обычные DOM-запросы, Testing Library DOM и user-event подключаются отдельно.

Для Vitest установите dev-зависимости `vitest`, `jsdom` и, если нужны запросы
по ролям/подписям, `@testing-library/dom`. Проверенная конфигурация:

```ts
// vitest.config.ts — отдельный конфиг тестов
import { defineConfig } from 'vitest/config';
import kansoTesting from '@kanso/vite/testing';

export default defineConfig({
  plugins: [kansoTesting()],
  test: { include: ['src/**/*.test.tsx'] },
});
```

Плагин компилирует исходники и тесты Kanso, подключает jsdom и единственный
браузерный Solid runtime. Используйте его вместо `kanso()` в этом конфиге.
HMR и сборка серверного JSX здесь отключены. Конфиг приложения продолжает
использовать обычный `kanso()`; SSR проверяется отдельно в Node/браузерных сценариях.
Проверенный набор: Vitest 4.1.11, jsdom 26.1.0, Testing Library DOM 10.4.1.

Для чистой установки этого набора с Node 22 используйте npm 11.12.1.
На Node 22.23.2/npm 10.9.8 воспроизведён внутренний сбой `edgesOut` при
разрешении peer dependencies Vitest, до запуска кода Kanso. Можно использовать
отдельный installer без изменения глобального npm:

```sh
npm exec --yes --package=npm@11.12.1 -- npm install -D vitest@4.1.11 jsdom@26.1.0 @testing-library/dom@10.4.1
```

Peer-проверки сохраняются; `--force` и `--legacy-peer-deps` не нужны.

```tsx
import { afterEach, expect, it } from 'vitest';
import { fireEvent, within } from '@testing-library/dom';
import { createTestScope } from '@kanso/core/testing';
import { Counter } from './Counter';

const scope = createTestScope();
afterEach(scope.cleanup);

it('сохраняет счётчик при изменении шага', () => {
  const view = scope.renderComponent(Counter, { props: { step: 1 } });
  const query = within(view.baseElement);
  fireEvent.click(query.getByRole('button', { name: 'Count: 0' }));

  view.setProps({ step: 2 });
  fireEvent.click(query.getByRole('button', { name: 'Count: 1' }));
  expect(query.getByRole('button', { name: 'Count: 3' })).toBeTruthy();
});
```

`setProps` поверхностно объединяет patch с текущими props. Вложенный объект
заменяется; `undefined` активирует default компонента, `null` сохраняется.
Обычные синхронные события и изменения props применяются сразу. Для асинхронных
запросов используйте `findBy*`/`waitFor`, а не задержки фиксированной длины.

`render(() => <App />)` принимает **фабрику**, чтобы JSX создавался под владельцем
теста. `wrapper` тоже получает ленивый `children`: Context/Services/Router можно
скомпоновать обычным JSX. Например, обёртка сервисов создаёт свой
`createServiceScope()`, передаёт его `ServiceProvider` и регистрирует
`onCleanup(() => services.dispose())`. Переданный извне scope принадлежит
вызывающему коду. MemoryRouter доступен через `@kanso/app/solid-router`; это
контракт Solid Router, а не замена всех опций React Router MemoryRouter.

Результат содержит `container`, `baseElement`, `unmount()` и `unmounted`.
`baseElement` — body документа; он включает порталы за пределами `container`.
Автоматически созданный контейнер удаляется, переданный пустой контейнер
очищается и остаётся в документе. Непустой контейнер отклоняется без изменений.
Для принятия SSR HTML используйте `hydrateRoot` и настоящий браузерный сценарий.

`unmount` и `scope.cleanup` идемпотентны; изменение props после unmount — ошибка.
Ошибка setup очищает созданный тестовый корень. Если cleanup одного корня
бросает исключение, scope очищает остальные и возвращает AggregateError.
Глобального реестра тестов нет. Для `it.concurrent` создавайте scope **внутри**
каждого теста и передавайте `scope.cleanup` в `onTestFinished` его контекста.

Запросы и assertions из React-тестов часто можно сохранить, но `rerender`,
`renderHook`, `act`, synthetic events и обёртки Router требуют осмысленного
переноса. Автоматическое переписывание произвольных тестов не выполняется.
Для hook используйте небольшой тестовый компонент с наблюдаемым DOM.
Тестовый runtime не включается в production, если приложение его не импортирует.

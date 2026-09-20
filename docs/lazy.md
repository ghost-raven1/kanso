# Lazy-страницы и интерактивные компоненты

Статический `import` включает модуль в граф начальной загрузки. `lazy` с динамическим
`import()` выделяет код в отдельный chunk. Vite сам выделяет общие зависимости;
Kanso не скачивает все страницы заранее.

```tsx
import { lazy, Suspense } from '@kanso/core';
import { defineRoutes } from '@kanso/app';

const Catalog = lazy(() => import('./pages/Catalog'));
const Editor = lazy(() => import('./Editor'));

export const routes = defineRoutes([
  { id: 'catalog', path: '/catalog', component: Catalog, pending: CatalogSkeleton },
]);

function EditorArea() {
  return (
    <Suspense fallback={<EditorSkeleton />}>
      <Editor />
    </Suspense>
  );
}
```

Обычный lazy запускается при первом рендере компонента. `Suspense.fallback` — любой JSX,
`Route.pending` — ваш компонент. Сервер ждёт lazy-страницу и отдаёт её HTML/SEO.
Для начальной гидратации подготовьте только активный маршрут:

```tsx
await hydrateWhenReady(async () => {
  await preloadRoute(routes, bootstrap.url);
  return { default: () => <App routes={routes} bootstrap={bootstrap} /> };
}, root);
```

`preloadRoute` экспортируется из `@kanso/app`: загружает код совпавшей страницы и layouts,
не выполняет data loaders. Если chunk недоступен, `hydrateWhenReady` сохраняет исходный HTML.
`LazyComponent.preload()` остаётся явной опцией для предварительной загрузки.

## Загрузка при взаимодействии

Для видимых интерактивных блоков есть декларативный режим `interaction`.
До взаимодействия SSR и клиент показывают лёгкую оболочку `fallback`. Тяжёлый модуль
загружается при наведении указателя, фокусе с клавиатуры, pointerdown или активации.
В обработчиках компонентов не нужны ручные `import()`.

```tsx
function CounterShell({ id }: { id: string }) {
  return <button id={id}>Count: 0</button>;
}

const Counter = lazy(() => import('./Counter'), {
  interaction: {
    fallback: CounterShell,
    pending: () => <Spinner label="Подключаем управление" />,
    error: ({ retry }) => <button onClick={retry}>Повторить загрузку</button>,
  },
});

// Counter.tsx — отдельный chunk
export default function Counter({ id }: { id: string }) {
  const [count, setCount] = useState(0);
  return <button id={id} onClick={() => setCount(value => value + 1)}>
    Count: {count}
  </button>;
}
```

Оболочка принимает те же props. Сохраняйте одинаковые уникальные `id` или `name` и тип
элемента для соответствующих controls в оболочке и полном компоненте. Тогда первая
активация во время загрузки воспроизводится один раз, input/textarea и фокус переносятся
в загруженный блок. Повторные активации до его готовности объединяются; несколько
экземпляров имеют отдельные состояние и очередь, общий импорт выполняется один раз.

`pending` показывается рядом с оболочкой, не уничтожая ввод. Можно заменить индикатор,
сообщение об ошибке и саму оболочку; автоматического retry по таймеру нет. Ошибка сбрасывает
ожидание импорта, повторный вызов снова обращается к loader. Если браузер закешировал
ошибку исполнения ESM или старый immutable chunk удалён, может понадобиться обновление страницы.

Уход с маршрута удаляет слушатели и очередь; поздний импорт не монтирует закрытый блок.
Сам сетевой `import()` браузер не позволяет отменить. `interaction` не создаёт отдельный
корень гидратации: Context и services остаются общими с приложением.

Этот режим заменяет оболочку DOM загруженным компонентом. Он не предназначен для
file inputs, contenteditable, сохранения DOM стороннего редактора или операций,
требующих доверенного browser gesture (`window.open`, clipboard, file picker):
синтетический replay не получает `isTrusted`. Такие небольшие обработчики оставляйте
в оболочке либо используйте обычный lazy. Не помещайте boundary внутрь table/select;
он использует wrapper с `display: contents`. Глобальный prefetch/precache приложения
может загрузить chunk раньше — не включайте отложенные модули в такие списки.

Лаборатория **Lazy route** проверяет два независимых блока, ввод до завершения загрузки,
один сетевой импорт и первое действие без повторного нажатия.

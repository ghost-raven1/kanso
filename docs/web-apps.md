# Маршруты, данные и формы — Kanso 0.5

Один цикл работает в серверном HTML, после гидратации и при переходах: loader → страница → POST action → ошибки или результат → обновление данных. Полный пример — [каталог](../examples/catalog/README.md).

С версии 0.10 POST ограничен 1 MiB (`createRequestHandler.maxBodyBytes`), cookie-запрос требует подтверждения same-origin. Правила actions, redirect, кеша и обновления зависимости описаны в [руководстве безопасности](security.md).

## Типизированные адреса

```tsx
import { defineRoutes, routeUrl, type RouteParams } from '@kanso/app';

export const routes = defineRoutes([
  {
    id: 'shop', path: '/shops/:shopId', component: ShopLayout,
    children: [
      { id: 'product', path: 'products/:productId', component: ProductPage },
    ],
  },
]);

const href = routeUrl(routes, 'product', {
  shopId: 'tokyo', productId: 'paper & pen',
}, new URLSearchParams({ source: 'catalog' }));
// /shops/tokyo/products/paper%20%26%20pen?source=catalog

type ProductParams = RouteParams<typeof routes, 'product'>;
```

`defineRoutes` сохраняет literal ID/path без `as const`. Параметры родительских маршрутов обязательны; неизвестные ID и отсутствующие параметры — ошибки TypeScript. Для статического адреса передайте `{}`. Splat `*files` принимает строку с `/`, кодируя каждый сегмент; безымянный `*` называется `rest`. Query передаётся через `URLSearchParams`, включая повторяющиеся параметры. `Link` по-прежнему принимает строковый `href`.

`useParams()` и `useLocation()` возвращают реактивные объекты. Чтения и деструктуризация в компоненте обновляются без повторного исполнения его тела. Импортированный `routeUrl()` допускается в производных вычислениях; одноимённая локальная функция не получает этот контракт автоматически.

## Серверные обработчики и типы результатов

```ts
// handlers.server.ts
import { defineRouteHandlers, redirect } from '@kanso/app/server';
import { routes } from './routes';

export const handlers = defineRouteHandlers(routes, {
  product: {
    loader: async ({ params, request, signal }) => {
      // params: { shopId: string; productId: string }
      const product = await repository.find(params.productId, { signal });
      if (!product) return new Response('Not found', { status: 404 });
      return { product };
    },
    action: async ({ request, params, signal }) => {
      const fields = await request.formData();
      await repository.save(params.productId, fields, { signal });
      return redirect('/thanks');
    },
  },
});
```

```tsx
import { useLoaderData, type LoaderData, type ActionData } from '@kanso/app';
import type { handlers } from './handlers.server';

type ProductData = LoaderData<typeof handlers.product.loader>;
type SubmissionData = ActionData<typeof handlers.product.action>;
```

`LoaderData` извлекает ожидаемый результат без `Response`; `ActionData` извлекает поле `data`. Action, возвращающий только redirect, имеет `ActionData = never`. `import type` стирается; runtime-import серверного модуля в клиент по-прежнему блокируется. Старый `Record<string, RouteHandlers<C>>` остаётся доступен для конфигурации с собственным context. Дополнительные запросы и генерация файлов типов не нужны.

Новая страница получает данные до выполнения её setup. При смене параметров уже активная страница использует новый snapshot. Отмена навигации запрещает публикацию старого ответа.

## Форма с ошибками и возвращённым вводом

```tsx
import { Form, useForm } from '@kanso/app';

type Values = { name: string; interests: string[] };

function RequestForm() {
  const form = useForm<{ saved: boolean }, Values>({ id: 'request' });

  return (
    <Form state={form} className="request-form" aria-busy={form.pending}>
      <label htmlFor="request-name">Имя</label>
      <input
        id="request-name"
        name="name"
        required
        value={form.values.name ?? ''}
        aria-invalid={!!form.errors.name}
        aria-describedby="request-name-error"
      />
      <p id="request-name-error">{form.errors.name}</p>
      {form.formError && <p role="alert">{form.formError}</p>}
      {form.error && <p role="alert">{form.error}</p>}
      <button name="intent" value="save" disabled={form.pending}>
        {form.pending ? 'Сохраняем…' : 'Сохранить'}
      </button>
    </Form>
  );
}
```

Action возвращает только сведения, которые автор решил показать:

```ts
const fields = await request.formData();
const name = String(fields.get('name') ?? '').trim();
if (name.length < 2) {
  return {
    errors: { name: 'Минимум два символа.' },
    formError: 'Проверьте выделенные поля.',
    values: { name },
  };
}
return { data: { saved: true }, values: { name } };
```

`values` содержит строки или массивы строк. Автоматического отражения всех полей, паролей или файлов нет. `values`, `errors`, `formError` и `data` из native POST попадают в необязательный `bootstrap.action`, связанный с ID маршрута и формы. Гидратация использует его без повторной отправки и initial loader.

| Поле | Контракт |
| --- | --- |
| `phase` | `idle`, `submitting`, `revalidating` |
| `pending` | true до завершения отправки и последующего обновления loaders |
| `errors` | Ошибки отдельных полей |
| `values` | Только явно возвращённые action значения |
| `formError` | Общая ошибка валидации от action |
| `error` | Сбой отправки или неожиданный HTTP-ответ |
| `data` | Последний успешный результат action |
| `revalidationError` | Отдельная ошибка обновления данных после сохранения |
| `id`, `routeId`, `action` | Идентичность формы и текущий URL страницы |

`useForm<T>(routeId?)` остаётся совместимым. В options-форме можно задать `routeId` и стабильный `id`; без `id` используется SSR-совместимый идентификатор Solid. Для нескольких форм на одном маршруте задавайте разные ID; не меняйте их между сервером и клиентом.

`Form` принимает нативные presentation/a11y-атрибуты, `class`/`className` и отменяемый `onSubmit`. Пользовательский обработчик может вызвать `event.preventDefault()`. Контроллер владеет `method` и `action`; не задавайте `formaction`/`formmethod` на кнопках. Браузер выполняет constraint validation до `submit`; в `FormData` входят повторяющиеся поля и `name/value` нажатой кнопки. Не обходите этот цикл вызовом DOM `form.submit()`; для нативной программной отправки используйте `requestSubmit()`.

## Серверный протокол

- Native POST отправляется на **URL страницы**, включая query. Скрытые `__kanso_route` и `__kanso_form` — зарезервированные имена транспорта; их не следует использовать как бизнес-поля.
- Усиленная JavaScript-отправка использует `/_kanso/action/:id` и `X-Kanso-Location`. Оба варианта передают action Request с URL страницы, params, context и signal.
- Action разрешён только для активного маршрута или его родителей. Переданный Origin должен совпадать с origin запроса. Node adapter получает явно заданный origin; при развёртывании настройте его в соответствии с публичным адресом приложения.
- Валидация: **422 HTML** без JS, **422 JSON** с JS. Успех без redirect: **200 HTML** либо JSON с последующим обновлением loaders.
- `redirect(url, status = 303, headers?)` поддерживает POST/Redirect/GET и сохраняет `Set-Cookie`. Native получает настоящий HTTP redirect; клиентский транспорт — `X-Kanso-Redirect` и переходит на страницу подтверждения.
- POST никогда не входит в общий HTML-кеш. Успех инвалидирует кеш; валидация сохраняет существующее поколение.
- GET-фильтры пишутся обычным `<form method="get">`. Данные запроса сохраняются в URL, работают прямые ссылки и история.

## Обновление без повторного сохранения

```tsx
const refresh = useRevalidator();
const retry = () => { void refresh.revalidate(); };

<button onClick={retry} disabled={refresh.pending}>Обновить данные</button>;
{refresh.error && <p role="alert">Показаны последние данные. Повторите обновление.</p>};
```

`revalidate(): Promise<void>` загружает всю активную цепочку маршрутов. При ошибке promise завершается, а ошибка доступна в `error`; последний успешный snapshot остаётся видимым. Повторный вызов не повторяет action. Не предлагайте пользователю снова отправлять уже сохранённую форму из-за сбоя обновления.

Новая отправка отменяет предыдущий клиентский запрос; результаты устаревшего запроса и ответы после размонтирования игнорируются. Автоматических повторов POST нет. Отмена fetch не доказывает отмену серверной записи: гарантии идемпотентности бизнес-операций остаются ответственностью сервиса.

## Границы

Без базы данных, авторизации, оплаты, optimistic updates и streaming SSR. JSON snapshot предназначен для JSON-совместимых данных; файлы не отражаются через `values`. При HMR действуют гарантии 0.4; этот релиз их не расширяет. Примеры и создаваемые шаблоны форматируются командой `npm run format:examples`; CI проверяет их через `npm run check:format`.

# Разработка на Kanso 0.4

## Создание проекта

```bash
kanso create my-app --template csr
kanso create my-site --template ssr
kanso doctor --root ./my-site --json
```

CSR — шаблон по умолчанию. SSR включает routes, loader в `.server.ts`, общую SEO-конфигурацию, клиентскую гидратацию, Node adapter и команды `dev`, `build`, `preview`, `typecheck`. В development HTML также рендерится сервером. Перед production-сборкой задайте `VITE_SITE_URL`; пример находится в `.env.example`. Сборка создаёт один build ID для клиента и сервера; preview проверяет их совпадение.

Пакеты пока не опубликованы в npm. Из репозитория сначала выполните `npm ci && npm run build`, затем используйте локальный CLI:

```bash
node packages/cli/dist/bin.js create ../my-site --template ssr --local "$PWD"
cd ../my-site
npm install
npm run dev
```

`create` не перезаписывает непустую папку и не запускает установку автоматически. `--local` остаётся поддержан для обоих шаблонов. Проверка tarball-пакетов в CI подтверждает, что их содержимое работает и без symlinks workspace; это не публикация в registry.

## Context и типы

```tsx
import { createContext, useContext, useId, useState } from '@kanso/core';

const Theme = createContext('light');

function Preview() {
  const theme = useContext(Theme);
  return <output>{theme}</output>;
}

function App() {
  const [theme, setTheme] = useState('light');
  const id = useId();
  return (
    <Theme.Provider value={theme}>
      <label htmlFor={id}>Theme</label>
      <input
        id={id}
        value={theme}
        onChange={event => setTheme(event.currentTarget.value)}
      />
      <Preview />
    </Theme.Provider>
  );
}
```

Provider передаёт живое значение: primitive, замена объекта и вложенные providers обновляют потребителей без повторного исполнения их компонентов. Default применяется при отсутствии provider; явно переданный `undefined` остаётся значением provider. Контексты, импортированные напрямую из Solid, сохраняют собственный контракт Solid.

`useId` создаёт DOM ID, согласованный между сервером и клиентом при одинаковом дереве и порядке вызовов. Он не заменяет ключ записи в БД или key списка. Как и другие hooks, вызывается безусловно в setup компонента или custom hook.

Экспортируются `ComponentProps<'input'>`, `ComponentProps<typeof MyComponent>`, `CSSProperties`, `RefObject<T>`. Ref для input типизирован как `HTMLInputElement`, для SVG — соответствующим SVG-элементом. События остаются нативными; SyntheticEvent не эмулируется.

## Деструктуризация

```tsx
function Card({ user: { name }, ...props }) {
  return <article {...props}>{name}</article>;
}

function useOptions({ nested: { step = 1 } = {} } = {}) {
  return { settings: { step }, values: [step, step * 2] };
}

function Preview() {
  const {
    settings: { step },
    values: [first, ...rest],
  } = useOptions();
  return (
    <p>
      {step} / {first} / {rest[0]}
    </p>
  );
}
```

Object/tuple patterns, переименование, вложенные defaults, object rest и array rest сохраняют реактивность. Object rest копирует собственные enumerable-поля, включая symbols. Defaults применяются к `undefined`, но не к `null`. Defaults параметров hooks инициализируются один раз при первом отсутствии значения; props defaults остаются реактивными. Локальные переменные обработчика сохраняют снимок, как и в предыдущих версиях Kanso.

Вычисляемые ключи и variadic-параметры hooks не поддерживаются. Неизвестные вызовы в производных вычислениях по-прежнему требуют явного `useMemo` либо переноса действия в `useEffect`.

## HMR

```ts
import kanso from '@kanso/vite';
export default { plugins: [kanso({ hmr: 'preserve' })] };
// hmr: 'remount' — обновлять со сбросом состояния
// hmr: false — отключить границы HMR Kanso
```

`preserve` включён по умолчанию в development. Компилятор регистрирует именованные компоненты и описывает структуру hooks, включая локальные custom hooks через импорты и переэкспорты. Каждому смонтированному экземпляру принадлежит отдельный набор сохранённых значений.

Правка JSX или обработчика сохраняет `useState`, `useReducer`, `useId` и пользовательские значения `useRef`. При правке реализации custom hook обновляются его потребители. Initializers сохранённого состояния не вызываются повторно. Эффекты очищаются и создаются заново; callbacks, memo и reducers используют новый код. DOM refs очищаются и заполняются новыми элементами. Идентичность module-scoped Context сохраняется при неизменной декларации.

Изменение порядка, вида, имён привязок или количества hooks сбрасывает состояние границы и выводит причину в консоль. Обычное размонтирование уничтожает сохранённые значения. Обновление родителя может пересоздать дочернее поддерево; перенос состояния между новыми экземплярами и сохранение DOM/фокуса не обещаются.

Неопределимые границы, анонимные компоненты, использование объявления до его инициализации и модули со смешанными некомпонентными exports передают обновление импортерам; если безопасной границы нет, Vite перезагружает страницу. Ошибка компиляции оставляет прежний интерфейс до исправления. HMR-runtime не включается в production или серверный код.

## Doctor и проверка миграции

`doctor` читает конфигурацию и установленные пакеты, не выполняет Vite config, не пишет файлы и не запускает npm install. Он проверяет Node/Vite, совпадение версий Kanso, JSX, подключение плагина, React-зависимости и физические копии Solid. Динамическую конфигурацию нужно привести к статически проверяемой форме.

Exit codes: `0` — ошибок нет, `2` — проблемы конфигурации, `1` — команда не смогла выполниться. JSON содержит версии и диагностики с полем, кодом, описанием и исправлением. Предупреждения не меняют успешный exit code.

Мигратор поддерживает `tsconfig paths/baseUrl/extends`, один application config с paths среди references и статические Vite aliases. Строковые Vite replacements должны быть абсолютными; переносимая форма — `fileURLToPath(new URL('./src', import.meta.url))`. Regex aliases, custom resolvers и динамический config блокируются. Пользовательский код конфигурации при проверке не исполняется.

Диагностики компилятора сохраняют коды `KANSO_*`, исходную строку/столбец и пример исправления; `--json` сохраняет прежние поля и добавляет необязательные позиции, hint и docsUrl. Snapshot-семантика не переписывается автоматически.

Проверки: `npm run test:hmr`, `npm run test:dx`. Исходные React fixtures находятся в `tests/fixtures/migration`: профиль, каталог, пользовательские hooks. Зависимости React устанавливаются только в игнорируемую `output/dx`; они отсутствуют в workspace lockfile и перенесённых приложениях.

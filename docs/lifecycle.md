# Refs, эффекты и вычисления в списках

## Измерение DOM

`useLayoutEffect` получает уже назначенные refs после синхронного рендера, перед обычными `useEffect` и отрисовкой браузера. При обновлениях сначала применяются DOM-привязки, затем layout-эффекты. Как и у `useEffect`, `[]` означает запуск при монтировании, явные зависимости сравниваются через `Object.is`, отсутствие массива включает отслеживание синхронных чтений. Cleanup выполняется перед следующим запуском и при удалении владельца. На сервере эффекты не запускаются.

```tsx
const input = useRef<HTMLInputElement>(null);

useLayoutEffect(() => {
  input.current?.focus();
}, []);

return <input ref={input} />;
```

Основа расписания — [эффекты Solid](https://docs.solidjs.com/reference/basic-reactivity/create-effect). Не следует предполагать отдельный browser paint между layout-эффектом и `useEffect`: Kanso не воспроизводит планировщик React. Для условно создаваемого поля размещайте ref и эффект внутри этого дочернего компонента.

`useRef()` разрешён без начального значения: `current` имеет тип `T | undefined`. DOM refs принимают объект или callback `(element: T | null) => void`. При удалении элемента callback получает `null`, объектная ссылка очищается. Пользовательские значения refs сохраняются при совместимом HMR; DOM refs назначаются новым элементам.

## API дочернего компонента

```tsx
interface FieldHandle {
  focus(): void;
}

const Field = forwardRef<FieldHandle, { label: string }>(({ label }, ref) => {
  const input = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => input.current?.focus(),
  }), []);

  return <label>{label}<input ref={input} /></label>;
});
```

Компилятор поддерживает `const Field = forwardRef((props, ref) => …)` с inline синхронным renderer, включая destructuring props. Экспортируйте полученный именованный компонент. Динамические фабрики, ссылка на renderer из другого модуля и анонимный `export default forwardRef(...)` требуют явного преобразования и получают `KANSO_FORWARD_REF`.

`useImperativeHandle` публикует значение в layout-фазе, обновляет его при изменении зависимостей или ref и очищает прежний handle. Без массива зависимостей factory отслеживает синхронные чтения. При HMR эффекты и handles создаются заново, совместимое состояние компонента сохраняется. Порядок произвольных эффектов разных компонентов не является контрактом.

## Нативные события и типы

Доступны `Ref`, `RefObject`, `MutableRefObject`, `ForwardedRef`, `RefCallback`, `ChangeEvent`, `FormEvent`, `MouseEvent`, `KeyboardEvent`, `FocusEvent`, `PointerEvent`, `TouchEvent`, `ClipboardEvent`. Типы событий описывают нативные DOM-события с конкретным `currentTarget`. `ReactElement` и `SyntheticEvent` не имитируются; `persist()`, `nativeEvent` и другие специфичные React члены требуют правки. Мигратор диагностирует такие обращения в типизированных обработчиках и inline JSX callbacks.

## Читаемые строки списка

```tsx
{items.map(({ id, details: { title = 'Untitled' }, ...rest }, index) => {
  const heading = title.toUpperCase();
  const position = index + 1;

  return (
    <li key={id}>
      <span>{position}. {heading}</span>
      <input placeholder={rest.note} />
    </li>
  );
})}
```

В callback допускаются чистые `const`, вложенные object/tuple patterns, defaults и rest, затем один JSX return с явным ключом. При замене объекта с прежним ключом вычисления строки обновляются; DOM, состояние дочерних компонентов и фокус сохраняются. Локальные переменные обработчиков остаются снимками.

Чистые преобразования `Boolean`, `String`, `Number` распознаются только для незатенённых глобальных функций. Неизвестные вызовы, побочные действия, hooks в setup строки и неоднозначные ветвления требуют дочернего компонента. Вычисление ключа может читать чистый setup отдельно, поэтому не используйте его для счётчиков вызовов или побочных эффектов.

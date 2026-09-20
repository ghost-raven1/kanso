# Модальные окна

`@kanso/core/overlays` — необязательный импорт. `Dialog` использует Portal и
нативный `<dialog>.showModal()`: фон становится неактивным, Tab остаётся в модальном
контексте, Escape обращается к верхнему окну. React и CSS-библиотека не нужны.

```tsx
import { useRef, useState } from '@kanso/core';
import { Dialog } from '@kanso/core/overlays';

function Settings() {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button ref={trigger} onClick={() => setOpen(true)}>Настройки</button>
      <Dialog
        open={open}
        aria-label="Настройки"
        onClose={() => setOpen(false)}
        returnFocus={() => trigger.current}
        className="settings-dialog"
      >
        <label>Имя<input autoFocus /></label>
        <button onClick={() => setOpen(false)}>Готово</button>
      </Dialog>
    </>
  );
}
```

Обязательно задайте `aria-label` или `aria-labelledby` и `onClose`. Для подтверждения
действия доступен `role="alertdialog"`, для описания — `aria-describedby`.
В длинном содержимом можно выбрать начальный фокус через `initialFocus={() => ref.current}`;
элемент должен находиться внутри окна. Заголовку для программного фокуса задайте `tabIndex={-1}`.

`onClose(reason)` — запрос с причиной `escape`, `backdrop` или `native` (например,
форма `method="dialog"`). Приложение подтверждает его изменением `open` на `false`.
Оставьте значение `true`, чтобы запретить закрытие или дождаться асинхронного подтверждения.
Клик по фону закрывает окно только при `closeOnBackdrop`; начало и конец клика должны
оказаться за границей окна. Кнопка внутри закрывает окно обычным `setOpen(false)`.

При открытии запоминается прежний фокус. `returnFocus` позволяет явно указать кнопку
открытия — полезно для WebKit, где pointer-клик не всегда фокусирует кнопку. При
закрытии фокус возвращается после завершения реактивного обновления, если цель
остаётся в документе и не заблокирована другим модальным окном. Уход с маршрута
удаляет содержимое и подписки; повторное открытие создаёт новое состояние детей.

Вложенные окна делят блокировку прокрутки документа. Закрытие верхнего сохраняет
блокировку родителя; закрытие последнего возвращает исходные inline-стили. При этом
само окно может прокручиваться. Dialog не предоставляет анимацию закрытия и не сохраняет
состояние размонтированных детей. Черновик, который должен пережить закрытие, храните выше.

Стили задаёт приложение: `className`, объектный `style`, `::backdrop` и CSS-переменные.
Portal сохраняет Context, но CSS наследуется от фактического места в `document.body`.
Размещайте общие theme variables на `:root`/`body` либо передавайте их самому окну.
Пример лаборатории показывает редактор и вложенное подтверждение с общей темой.

SSR не вычисляет modal children и browser refs, включая `open={true}`. Окно появляется
после монтирования клиента; основной серверный контент остаётся доступным без JS.
Для содержимого, обязательного в исходном HTML, используйте обычную страницу.

Основа поведения — [нативный HTMLDialogElement](https://developer.mozilla.org/en-US/docs/Web/API/HTMLDialogElement/showModal).
Поддерживаются современные Chromium, Firefox и WebKit с `showModal()`; polyfill в пакет не входит.

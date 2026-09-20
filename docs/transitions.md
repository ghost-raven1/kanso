# useTransition и кастомная анимация

```tsx
import { lazy, Suspense, useRef, useState, useTransition } from '@kanso/core';

const Editor = lazy(() => import('./Editor'));

function Workspace() {
  const [editing, setEditing] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const [isPending, startTransition] = useTransition({
    animation: {
      target: () => panel.current,
      enter: [
        { opacity: 0, transform: 'translateY(8px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      timing: { duration: 220, easing: 'ease-out' },
    },
  });

  return (
    <>
      <button onClick={() => startTransition(() => setEditing(true))}>
        Редактировать
      </button>
      {isPending && <span role="status">Готовим редактор…</span>}
      <div ref={panel} aria-busy={isPending}>
        <Suspense fallback={<EditorSkeleton />}>
          {editing ? <Editor /> : <Preview />}
        </Suspense>
      </div>
    </>
  );
}
```

Без аргументов доступен тот же `[isPending, startTransition]`. Компилятор превращает
`isPending` в реактивное чтение: вызовы getter и `.value` не нужны.

`startTransition(update)` возвращает Promise и запускает **синхронные изменения состояния**
через transition Solid. Он ждёт участвующие `lazy`/resources под Suspense и commit DOM,
затем анимацию появления. Уже показанная ветка Suspense остаётся до готовности новой.
При первоначальной загрузке используется ваш `Suspense.fallback`; pending-индикатор
во время перехода разработчик рисует через `isPending`.

`animation.target` возвращает элемент; `enter` и необязательный `exit` — стандартные
Web Animations keyframes, `timing` — duration/easing/delay и другие конечные параметры.
По умолчанию duration 180ms. `exit` выполняется перед update, его последний кадр сохраняется
до commit; `enter` начинается после commit. Если exit делает старый контент прозрачным,
он будет прозрачным и во время ожидания данных — выбирайте такой эффект осознанно.
В конце временные эффекты отменяются, inline-стили приложения не переписываются.

`prefers-reduced-motion: reduce`, отсутствующий target или Web Animations отключают
анимацию; само обновление продолжает работать. Сервер выполняет update синхронно,
pending остаётся false, browser refs и анимации не вычисляются.

Новый вызов отменяет анимацию и ещё не запущенный callback предыдущего вызова. Уже
выполненное изменение состояния не откатывается; браузерный import не отменяется.
Размонтирование прекращает анимацию и дальнейшую работу владельца. Отменённое ожидание
завершается без ошибки. Ошибка callback/анимации отклоняет Promise; обработайте её, если
вызов может завершиться неуспешно. Отдельные владельцы не разделяют pending-анимации,
но Solid может объединять одновременные изменения в общую транзакцию.

Не передавайте async callback и не оборачивайте только сам `fetch`: transition отслеживает
реактивные ресурсы внутри Suspense, а не произвольные Promise приложения. Это не scheduler
React и не обещание прерывать любое тяжёлое вычисление CPU. Для него используйте Web Worker.
Мигратор пока оставляет React `useTransition` на ручную проверку семантики.

Основа: [Solid useTransition](https://docs.solidjs.com/reference/reactive-utilities/use-transition)
и [Web Animations finished](https://developer.mozilla.org/en-US/docs/Web/API/Animation/finished).

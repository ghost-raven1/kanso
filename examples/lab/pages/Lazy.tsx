import { lazy, Suspense, useRef, useState, useTransition } from '@kanso/core';

function CounterShell({ id }: { id: string }) {
  return (
    <div>
      <label htmlFor={`${id}-draft`}>Deferred draft {id}</label>
      <input id={`${id}-draft`} />
      <button id={`${id}-increment`}>Deferred count {id}: 0</button>
    </div>
  );
}

const DeferredCounter = lazy(() => import('../ui/InteractionCounter'), {
  interaction: {
    fallback: CounterShell,
    pending: () => <p role="status">Подключаем интерактивный модуль…</p>,
    error: ({ retry }) => (
      <button onClick={retry}>Retry deferred counter</button>
    ),
  },
});
const AdvancedPanel = lazy(() => import('../ui/AdvancedPanel'));

export default function LazyPage() {
  const [advanced, setAdvanced] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const [isPending, startTransition] = useTransition({
    animation: {
      target: () => panel.current,
      enter: [
        { opacity: 0.3, transform: 'translateY(10px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      timing: { duration: 240, easing: 'ease-out' },
    },
  });
  return (
    <article className="panel compact">
      <span className="tag">SEPARATE CHUNK</span>
      <h2>This route arrived on demand.</h2>
      <p>
        Код маршрута отделён от начальной клиентской сборки. Сервер может
        отрендерить его при прямом открытии.
      </p>
      <div className="lazy-symbol" aria-hidden="true">
        ↗
      </div>
      <h3>Код по взаимодействию</h3>
      <p>
        HTML уже виден. Наведение, фокус или касание подключают модуль; первое
        действие сохраняется.
      </p>
      <DeferredCounter id="first" />
      <DeferredCounter id="second" />
      <h3>Переход с вашей анимацией</h3>
      <label>
        Transition panel
        <select
          value={advanced ? 'advanced' : 'basic'}
          onChange={event => {
            const next = event.currentTarget.value === 'advanced';
            void startTransition(() => setAdvanced(next));
          }}
        >
          <option value="basic">Basic</option>
          <option value="advanced">Advanced</option>
        </select>
      </label>
      <p aria-live="polite" id="transition-state">
        {isPending ? 'Preparing panel…' : 'Panel ready'}
      </p>
      <div ref={panel} aria-busy={isPending}>
        <Suspense fallback={<p role="status">Ваш skeleton нового раздела</p>}>
          {advanced ? (
            <AdvancedPanel />
          ) : (
            <p>Basic panel remains visible while loading.</p>
          )}
        </Suspense>
      </div>
    </article>
  );
}

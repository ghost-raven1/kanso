import { useEffect, useState } from '@kanso/core';
import { Seo } from '@kanso/app/seo';
import { useCounter } from '../hooks/useCounter';
import { KeyedList } from '../ui/KeyedList';

const counterSource = `const [count, setCount] = useState(0);
const doubled = count * 2;

return (
  <button onClick={() =>
    setCount(value => value + 1)
  }>
    {count} / {doubled}
  </button>
);`;

/** Show independent state and derived bindings without rerunning the component. */
function Counter({ step = 1 }: { step?: number }) {
  if (typeof window !== 'undefined' && window.kansoMetrics) {
    window.kansoMetrics.counterMounts++;
  }

  const { count, doubled, increment } = useCounter(step);

  return (
    <div className="counter-area">
      <Seo title={{ absolute: `Kanso · ${count}` }} />

      <div className="readout">
        <span>COUNT</span>
        <output id="count">{count}</output>
      </div>

      <div className="readout secondary">
        <span>DERIVED × 2</span>
        <output id="doubled">{doubled}</output>
      </div>

      <button id="increment" className="primary" onClick={increment}>
        Increment +{step} <span>↗</span>
      </button>
    </div>
  );
}

/** Track the subscription lifetime so the lab can demonstrate cleanup. */
function Subscription() {
  useEffect(() => {
    if (window.kansoMetrics) {
      window.kansoMetrics.activeEffects++;
    }

    return () => {
      if (window.kansoMetrics) {
        window.kansoMetrics.activeEffects--;
      }
    };
  }, []);

  return (
    <span className="status">
      <i />
      Subscription active
    </span>
  );
}

export default function Home() {
  const [step, setStep] = useState(1);
  const [visible, setVisible] = useState(true);

  const toggleStep = () => setStep(value => (value === 1 ? 2 : 1));
  const toggleSubscription = () => setVisible(value => !value);

  return (
    <>
      <div className="grid">
        <article className="panel">
          <div className="panel-heading">
            <span className="tag">LIVE EXAMPLE</span>
            <h2>One update. Two bindings.</h2>
            <p>
              Состояние и вычисляемое значение обновляются независимо от тела
              компонента.
            </p>
          </div>

          <Counter step={step} />

          <div className="panel-bottom">
            <button id="step" onClick={toggleStep}>
              Step: {step}
            </button>
            <span>Props remain reactive</span>
          </div>
        </article>

        <article className="panel code-panel">
          <span className="tag">YOUR SOURCE</span>
          <pre>
            <code>{counterSource}</code>
          </pre>
          <div className="code-note">
            No .value · No getter calls · No manual memo
          </div>
        </article>
      </div>

      <div className="grid">
        <KeyedList />

        <article className="panel compact">
          <span className="tag">LIFECYCLE</span>
          <h2>Subscriptions have an owner.</h2>
          <p>
            Убираем компонент — выполняем cleanup. Возвращаем — создаём одну
            новую подписку.
          </p>

          <div className="subscription">{visible && <Subscription />}</div>

          <button id="toggle-effect" onClick={toggleSubscription}>
            {visible ? 'Unmount effect' : 'Mount effect'}
          </button>
        </article>
      </div>
    </>
  );
}

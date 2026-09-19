import { useState, useEffect } from '@kanso/core';
import { KeyedList } from '../ui/KeyedList';

function Counter({ step = 1 }: { step?: number }) {
  if (typeof window !== 'undefined' && window.kansoMetrics) window.kansoMetrics.counterMounts++;
  const [count, setCount] = useState(0);
  const doubled = count * 2;
  useEffect(() => { document.title = `Kanso · ${count}`; }, [count]);
  return <div className="counter-area"><div className="readout"><span>COUNT</span><output id="count">{count}</output></div><div className="readout secondary"><span>DERIVED × 2</span><output id="doubled">{doubled}</output></div><button id="increment" className="primary" onClick={() => setCount(value => value + step)}>Increment +{step} <span>↗</span></button></div>;
}

function Subscription() {
  useEffect(() => {
    if (window.kansoMetrics) window.kansoMetrics.activeEffects++;
    return () => { if (window.kansoMetrics) window.kansoMetrics.activeEffects--; };
  }, []);
  return <span className="status"><i/>Subscription active</span>;
}

export default function Home() {
  const [step, setStep] = useState(1);
  const [visible, setVisible] = useState(true);
  return <>
    <div className="grid"><article className="panel"><div className="panel-heading"><span className="tag">LIVE EXAMPLE</span><h2>One update. Two bindings.</h2><p>Состояние и вычисляемое значение обновляются независимо от тела компонента.</p></div><Counter step={step}/><div className="panel-bottom"><button id="step" onClick={() => setStep(value => value === 1 ? 2 : 1)}>Step: {step}</button><span>Props remain reactive</span></div></article>
    <article className="panel code-panel"><span className="tag">YOUR SOURCE</span><pre><code>{`const [count, setCount] = useState(0);\nconst doubled = count * 2;\n\nreturn (\n  <button onClick={() =>\n    setCount(value => value + 1)\n  }>\n    {count} / {doubled}\n  </button>\n);`}</code></pre><div className="code-note">No .value · No getter calls · No manual memo</div></article></div>
    <div className="grid"><KeyedList/><article className="panel compact"><span className="tag">LIFECYCLE</span><h2>Subscriptions have an owner.</h2><p>Убираем компонент — выполняем cleanup. Возвращаем — создаём одну новую подписку.</p><div className="subscription">{visible && <Subscription/>}</div><button id="toggle-effect" onClick={() => setVisible(value => !value)}>{visible ? 'Unmount effect' : 'Mount effect'}</button></article></div>
  </>;
}

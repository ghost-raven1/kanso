import {
  createContext,
  Portal,
  useContext,
  useId,
  useRef,
  useState,
} from '@kanso/core';
import styles from './PortalExample.module.css';

const Theme = createContext('light');

/** A nonmodal panel outside the layout still belongs to its original provider. */
function FloatingPanel({ onClose }: { onClose(): void }) {
  const theme = useContext(Theme);
  const id = useId();
  const [count, setCount] = useState(0);

  return (
    <aside
      className={styles.floating}
      data-theme={theme}
      aria-label="Portal example"
    >
      <span className="tag">CONTEXT: {theme}</span>
      <h2>За пределами layout</h2>
      <p>Смените тему в панели лаборатории — черновик и счётчик останутся.</p>
      <label htmlFor={id}>Portal draft</label>
      <input id={id} placeholder="Локальный черновик" />
      <div className={styles.actions}>
        <button onClick={() => setCount(value => value + 1)}>
          Portal count: {count}
        </button>
        <button onClick={onClose}>Close portal</button>
      </div>
    </aside>
  );
}

export default function PortalExample() {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState('light');
  const trigger = useRef<HTMLButtonElement>(null);

  function close() {
    setOpen(false);
    // The click batch first enables the trigger again, then focus can return.
    queueMicrotask(() => trigger.current?.focus());
  }

  return (
    <article className="panel compact">
      <span className="tag">PORTAL & CONTEXT</span>
      <h2>Другое место. Тот же владелец.</h2>
      <p>
        Панель появляется в document.body после загрузки клиента. Это
        немодальный пример: фокус остаётся свободным, после закрытия
        возвращается на кнопку.
      </p>
      <div className={styles.actions}>
        <button ref={trigger} onClick={() => setOpen(true)} disabled={open}>
          Open portal
        </button>
        <button
          onClick={() =>
            setTheme(value => (value === 'light' ? 'dark' : 'light'))
          }
        >
          Portal theme: {theme}
        </button>
      </div>
      <Theme.Provider value={theme}>
        {open && (
          <Portal>
            <FloatingPanel onClose={close} />
          </Portal>
        )}
      </Theme.Provider>
    </article>
  );
}

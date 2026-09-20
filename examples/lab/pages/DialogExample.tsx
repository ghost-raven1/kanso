import {
  createContext,
  useContext,
  useId,
  useRef,
  useState,
} from '@kanso/core';
import { Dialog } from '@kanso/core/overlays';
import { Link } from '@kanso/app';
import styles from './DialogExample.module.css';

const Theme = createContext('light');

/** The editor and its nested confirmation share Context, but have separate focus lifecycles. */
function Editor({
  close,
  returnFocus,
}: {
  close(): void;
  returnFocus(): HTMLElement | null;
}) {
  const theme = useContext(Theme);
  const [confirmation, setConfirmation] = useState(false);
  const [locked, setLocked] = useState(false);
  const title = useId();
  const field = useRef<HTMLInputElement>(null);
  const deleteTrigger = useRef<HTMLButtonElement>(null);

  return (
    <Dialog
      open
      aria-labelledby={title}
      className={styles.dialog}
      initialFocus={() => field.current}
      returnFocus={returnFocus}
      closeOnBackdrop
      onClose={() => {
        if (!locked) close();
      }}
    >
      <div data-theme={theme} className={styles.surface}>
        <h2 id={title}>Edit profile</h2>
        <p>Тема из Context: {theme}. Escape закрывает только верхнее окно.</p>
        <label>
          Profile name
          <input ref={field} placeholder="Черновик" />
        </label>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={locked}
            onChange={event => setLocked(event.currentTarget.checked)}
          />
          Keep dialog open
        </label>
        <div className={styles.actions}>
          <button ref={deleteTrigger} onClick={() => setConfirmation(true)}>
            Delete profile
          </button>
          <button onClick={close}>Close editor</button>
          <Link href="/">Leave modal route</Link>
        </div>
        <Dialog
          open={confirmation}
          role="alertdialog"
          aria-label="Confirm deletion"
          className={styles.dialog}
          onClose={() => setConfirmation(false)}
          returnFocus={() => deleteTrigger.current}
        >
          <div data-theme={theme} className={styles.surface}>
            <h2>Подтверждение действия</h2>
            <p>Это демонстрация: данные не удаляются.</p>
            <button onClick={() => setConfirmation(false)}>
              Cancel deletion
            </button>
          </div>
        </Dialog>
      </div>
    </Dialog>
  );
}

export default function DialogExample() {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState('light');
  const trigger = useRef<HTMLButtonElement>(null);

  return (
    <article className="panel compact">
      <span className="tag">ACCESSIBLE DIALOGS</span>
      <h2>Фокус остаётся в диалоге</h2>
      <p>
        Нативный modal, вложенное подтверждение и возврат фокуса после закрытия.
      </p>
      <div className={styles.actions}>
        <button ref={trigger} onClick={() => setOpen(true)}>
          Open profile editor
        </button>
        <button
          onClick={() =>
            setTheme(value => (value === 'light' ? 'dark' : 'light'))
          }
        >
          Dialog theme: {theme}
        </button>
      </div>
      <Theme.Provider value={theme}>
        {open && (
          <Editor
            close={() => setOpen(false)}
            returnFocus={() => trigger.current}
          />
        )}
      </Theme.Provider>
    </article>
  );
}

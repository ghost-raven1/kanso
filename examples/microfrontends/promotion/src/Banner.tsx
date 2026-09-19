import { useState } from '@kanso/core';
import styles from './Banner.module.css';

/** An independent widget communicates with its host through ordinary props. */
export default function Banner(props: {
  message: string;
  onDismiss?: () => void;
}) {
  const [dismissed, setDismissed] = useState(false);

  return (
    <aside
      className={styles.banner}
      data-promotion={import.meta.env.VITE_RELEASE}
    >
      <span>{dismissed ? 'Увидимся в следующем выпуске.' : props.message}</span>
      <button
        id="dismiss-promotion"
        disabled={dismissed}
        onClick={() => {
          setDismissed(true);
          props.onDismiss?.();
        }}
      >
        {dismissed ? 'Готово' : 'Понятно'}
      </button>
    </aside>
  );
}

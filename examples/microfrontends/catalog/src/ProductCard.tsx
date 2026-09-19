import { useContext, useId, useState, type Context } from '@kanso/core';
import styles from './card.module.css';

export default function ProductCard(props: {
  productId: string;
  settings: Context<{ step: number }>;
}) {
  const [count, setCount] = useState(0);
  const label = useId();
  const settings = useContext(props.settings);

  return (
    <article className={styles.card} data-remote-card={props.productId}>
      <span className={styles.tag}>
        CATALOG · {import.meta.env.VITE_RELEASE}
      </span>
      <h2>One component. Its own release.</h2>
      <p>
        Оболочка передаёт props и Context, а компонент обновляет нужные
        значения.
      </p>
      <label htmlFor={label}>Заметка к товару</label>
      <input id={label} placeholder="Ввод сохраняется при гидратации" />
      <button onClick={() => setCount(value => value + settings.step)}>
        {props.productId}: {count}
      </button>
    </article>
  );
}

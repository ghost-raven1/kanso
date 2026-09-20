import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from '@kanso/core';
import PortalExample from './PortalExample';

interface InputHandle {
  focus(): void;
}

/** Expose one useful operation; DOM ownership and cleanup stay inside the field. */
const DraftField = forwardRef<InputHandle, { label: string }>(
  ({ label }, ref) => {
    const input = useRef<HTMLInputElement>(null);
    const [attached, setAttached] = useState(false);

    useImperativeHandle(
      ref,
      () => ({ focus: () => input.current?.focus() }),
      [],
    );
    useLayoutEffect(() => {
      setAttached(input.current?.isConnected === true);
    }, []);

    return (
      <div>
        <label>
          {label}
          <input
            ref={input}
            aria-label="Lifecycle draft"
            placeholder="Введите черновик"
          />
        </label>
        <p role="status">
          {attached ? 'DOM подключён; ref доступен' : 'Серверный HTML'}
        </p>
      </div>
    );
  },
);

export default function Lifecycle() {
  const field = useRef<InputHandle>(null);
  const [visible, setVisible] = useState(true);
  const [items, setItems] = useState([
    { id: 'alpha', details: { label: 'Alpha' }, note: 'Первый' },
    { id: 'beta', details: { label: 'Beta' }, note: 'Второй' },
  ]);

  return (
    <div className="grid">
      <PortalExample />
      <article className="panel compact">
        <span className="tag">REFS & LAYOUT</span>
        <h2>Фокус через API компонента</h2>
        <p>Поле отдаёт метод focus. При размонтировании ссылка очищается.</p>
        {visible && <DraftField ref={field} label="Черновик" />}
        <button onClick={() => field.current?.focus()}>Focus draft</button>
        <button onClick={() => setVisible(value => !value)}>
          {visible ? 'Unmount field' : 'Mount field'}
        </button>
      </article>
      <article className="panel compact">
        <span className="tag">LIVE ROW CALCULATIONS</span>
        <h2>Обычный map, живые значения</h2>
        <ul className="keyed-list">
          {items.map(({ id, details: { label }, ...rest }, index) => {
            const title = label.toUpperCase();
            const position = index + 1;
            return (
              <li key={id} data-live-row={id}>
                <span>
                  {position}. {title}
                </span>
                <input aria-label={`Note ${id}`} placeholder={rest.note} />
              </li>
            );
          })}
        </ul>
        <button
          onClick={() =>
            setItems(previous =>
              [...previous].reverse().map(item => ({
                ...item,
                details: { label: item.details.label + '!' },
              })),
            )
          }
        >
          Replace & reorder
        </button>
      </article>
    </div>
  );
}

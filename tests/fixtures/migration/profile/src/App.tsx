import React, {
  createContext,
  useContext,
  useId,
  useRef,
  useState,
  forwardRef,
  useLayoutEffect,
  useImperativeHandle,
  type ComponentProps,
  type CSSProperties,
} from 'react';
const Theme = createContext('light');
const style: CSSProperties = { padding: 8 };
export class DraftError extends Error {}

function Draft() {
  const [value, setValue] = useState('');
  return (
    <input
      aria-label="Draft"
      value={value}
      onChange={event => setValue(event.currentTarget.value)}
    />
  );
}
const Field = forwardRef<HTMLInputElement, ComponentProps<'input'>>((props, ref) => {
  const input = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => input.current!, []);
  useLayoutEffect(() => {
    input.current?.setAttribute('data-attached', String(input.current.isConnected));
  }, []);
  return <input {...props} ref={input} />;
});
function Preview() {
  const theme = useContext(Theme);
  return <output data-theme>{theme}</output>;
}
export function App() {
  const [theme, setTheme] = useState('light');
  const [name, setName] = useState('Alex');
  const [revision, setRevision] = useState(0);
  const [markup, setMarkup] = useState('<b>Initial draft</b>');
  const input = useRef<HTMLInputElement | null>(null);
  const id = useId();
  return (
    <Theme.Provider value={theme}>
      <main style={style}>
        <label htmlFor={id}>Name</label>
        <Field
          id={id}
          ref={input}
          value={name}
          onChange={event => setName(event.currentTarget.value)}
        />
        <p data-name>{name}</p>
        <Preview />
        <button
          onClick={() =>
            setTheme(value => (value === 'light' ? 'dark' : 'light'))
          }
        >
          Theme
        </button>
        <button onClick={() => input.current?.focus()}>Focus</button>
        <React.Fragment>
          <Draft key={revision} />
          <article data-markup dangerouslySetInnerHTML={{ __html: markup }} />
          <button
            onClick={() => {
              setRevision(value => value + 1);
              setMarkup('<em>Draft reset</em>');
            }}
          >
            Reset draft
          </button>
        </React.Fragment>
      </main>
    </Theme.Provider>
  );
}

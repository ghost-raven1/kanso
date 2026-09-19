import {
  createContext,
  useContext,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
} from 'react';
const Theme = createContext('light');
const style: CSSProperties = { padding: 8 };
function Field(props: ComponentProps<'input'>) {
  return <input {...props} />;
}
function Preview() {
  const theme = useContext(Theme);
  return <output data-theme>{theme}</output>;
}
export function App() {
  const [theme, setTheme] = useState('light');
  const [name, setName] = useState('Alex');
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
      </main>
    </Theme.Provider>
  );
}

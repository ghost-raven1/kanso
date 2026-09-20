import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from '@kanso/core';

export const trace = {
  parents: 0,
  mounts: 0,
  cleanups: 0,
  refs: [] as { current: HTMLInputElement | null }[],
  summaries: 0,
};

const Metadata = createContext({ title: 'default' });
const useTitle = () => useContext(Metadata).title;
const TitleText = () => useContext(Metadata).title;
function Summary() {
  trace.summaries++;
  const title = useTitle();
  const { heading } = useMemo(() => ({ heading: title.toUpperCase() }), [title]);
  return <output data-summary>{heading}<span data-title><TitleText /></span></output>;
}

function Editor() {
  trace.mounts++;
  const [count, setCount] = useState(0);
  const id = useId();
  const input = useRef<HTMLInputElement | null>(null);
  trace.refs.push(input);
  useEffect(
    () => () => {
      trace.cleanups++;
    },
    [],
  );

  return (
    <section data-editor>
      <label htmlFor={id}>Draft</label>
      <input id={id} ref={input} />
      <button data-count onClick={() => setCount(value => value + 1)}>
        {count}
      </button>
    </section>
  );
}

/** Exercises independently keyed siblings and raw HTML in the same hydration tree. */
export function App() {
  trace.parents++;
  const [revision, setRevision] = useState(0);
  const [markup, setMarkup] = useState('<strong>Server markup</strong>');

  return (
    <main>
      <Editor key={revision} />
      <Editor />
      <Metadata.Provider value={{ title: revision === 0 ? 'first' : 'next' }}>
        <Summary />
      </Metadata.Provider>
      <button id="reset" onClick={() => setRevision(value => value + 1)}>
        Reset first
      </button>
      <button id="update" onClick={() => setMarkup('<em>Updated markup</em>')}>
        Update HTML
      </button>
      <button id="clear" onClick={() => setMarkup('')}>
        Clear HTML
      </button>
      <article dangerouslySetInnerHTML={{ __html: markup }} />
      <aside {...{ dangerouslySetInnerHTML: { __html: markup } }} />
    </main>
  );
}

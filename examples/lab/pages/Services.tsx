import { useService, useStore } from '@kanso/core';
import { Link, useRevalidator } from '@kanso/app';
import { settings } from '../services/settings';

function Theme() {
  const store = useService(settings);
  const theme = useStore(store, state => state.theme);

  return (
    <button
      id="service-theme"
      onClick={() =>
        store.setState({ theme: theme === 'light' ? 'dark' : 'light' })
      }
    >
      Theme: {theme}
    </button>
  );
}

function Counter() {
  const store = useService(settings);
  const count = useStore(store, state => state.count);

  return (
    <button
      id="service-count"
      onClick={() => store.setState({ count: count + 1 })}
    >
      Count: {count}
    </button>
  );
}

export default function Services() {
  const store = useService(settings);
  const workspace = useStore(store, state => state.workspace);
  const refresh = useRevalidator();

  return (
    <div className="grid">
      <article className="panel compact">
        <span className="tag">REQUEST → HTML → HYDRATION</span>
        <h2 id="service-workspace">Workspace: {workspace}</h2>
        <p>
          Loader заполняет store на сервере. Гидратация принимает его снимок, а
          виджеты подписываются только на выбранные значения.
        </p>
        <Theme />
        <Counter />
        <button
          disabled={refresh.pending}
          onClick={() => void refresh.revalidate()}
        >
          Restore server data
        </button>
        <nav aria-label="Service workspaces">
          <Link href="/services/alpha">Alpha</Link>
          <Link href="/services/beta">Beta</Link>
        </nav>
      </article>
      <article className="panel code-panel">
        <span className="tag">YOUR SOURCE</span>
        <pre>
          <code>{`const store = useService(settings);
const count = useStore(store, state => state.count);

return (
  <button onClick={() =>
    store.setState({ count: count + 1 })
  }>
    Count: {count}
  </button>
);`}</code>
        </pre>
        <p className="code-note">
          One scope per app · Explicit snapshots · Automatic unsubscribe
        </p>
      </article>
    </div>
  );
}

import { defineRoutes, Link } from '@kanso/app';
import { lazy, type PropsWithChildren } from '@kanso/core';
import Home from './pages/Home';
import Data from './pages/Data';
import SeoPage, { SeoExample } from './pages/Seo';
import { defineRouteSeo } from '@kanso/app/seo';
import Lifecycle from './pages/Lifecycle';
import Services from './pages/Services';

function Layout({ children }: PropsWithChildren) {
  return (
    <>
      <header className="topbar">
        <Link href="/" class="brand">
          簡素 <span>kanso</span>
        </Link>
        <span className="version">FRAMEWORK LAB</span>
        <a
          href="https://github.com/solidjs/solid"
          target="_blank"
          rel="noreferrer"
        >
          Powered by Solid ↗
        </a>
      </header>
      <main>
        <div className="intro">
          <p className="eyebrow">LESS WORK. SAME FAMILIAR SYNTAX.</p>
          <h1>
            Write the component.
            <br />
            <span>Skip the rerenders.</span>
          </h1>
          <p className="lead">
            Привычный TSX, точечные обновления и серверный рендеринг.
            <br />
            React не входит в зависимости этого приложения.
          </p>
        </div>
        <nav aria-label="Lab sections">
          <Link href="/" end>
            01 · Reactivity
          </Link>
          <Link href="/data">02 · Data & forms</Link>
          <Link href="/lazy">03 · Lazy route</Link>
          <Link href="/seo">04 · SEO</Link>
          <Link href="/services/alpha">05 · Stores & services</Link>
          <Link href="/lifecycle">06 · Refs & lists</Link>
        </nav>
        <section className="workspace">{children}</section>
        <footer>
          <span>React-shaped source → Kanso compiler → Solid → DOM</span>
          <span>Built to be inspected.</span>
        </footer>
      </main>
    </>
  );
}

export const routes = defineRoutes([
  {
    id: 'layout',
    path: '/',
    component: Layout,
    children: [
      {
        id: 'lifecycle',
        path: '/lifecycle',
        component: Lifecycle,
        seo: { title: 'Refs & lists' },
      },
      {
        id: 'services',
        path: '/services/:name',
        component: Services,
        seo: { title: 'Stores & services' },
      },
      { id: 'home', path: '/', component: Home, sitemap: true },
      {
        id: 'data',
        path: '/data',
        component: Data,
        seo: { title: 'Data & forms' },
      },
      {
        id: 'lazy',
        path: '/lazy',
        component: lazy(() => import('./pages/Lazy')),
        pending: () => <p role="status">Loading route…</p>,
        seo: { title: 'Lazy route' },
        sitemap: true,
      },
      {
        id: 'seo',
        path: '/seo',
        component: SeoPage,
        seo: { title: 'SEO' },
        sitemap: true,
      },
      {
        id: 'seo-example',
        path: '/seo/example/:slug',
        component: SeoExample,
        seo: defineRouteSeo<{ name: string; description: string }>(
          ({ data }) => ({ title: data.name, description: data.description }),
        ),
      },
    ],
  },
]);

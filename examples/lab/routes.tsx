import { defineRoutes, Link } from '@kanso/app';
import { lazy, type PropsWithChildren } from '@kanso/core';
import Home from './pages/Home';
import Data from './pages/Data';

function Layout({ children }: PropsWithChildren) {
  return <>
    <header className="topbar"><Link href="/" class="brand">簡素 <span>kanso</span></Link><span className="version">FRAMEWORK LAB / 0.1</span><a href="https://github.com/solidjs/solid" target="_blank" rel="noreferrer">Powered by Solid ↗</a></header>
    <main><div className="intro"><p className="eyebrow">LESS WORK. SAME FAMILIAR SYNTAX.</p><h1>Write the component.<br/><span>Skip the rerenders.</span></h1><p className="lead">Привычный TSX, точечные обновления и серверный рендеринг.<br/>React не входит в зависимости этого приложения.</p></div>
    <nav aria-label="Lab sections"><Link href="/" end>01 · Reactivity</Link><Link href="/data">02 · Data & forms</Link><Link href="/lazy">03 · Lazy route</Link></nav>
    <section className="workspace">{children}</section>
    <footer><span>React-shaped source → Kanso compiler → Solid → DOM</span><span>Built to be inspected.</span></footer></main>
  </>;
}

export const routes = defineRoutes([{ id: 'layout', path: '/', component: Layout, children: [
  { id: 'home', path: '/', component: Home },
  { id: 'data', path: '/data', component: Data },
  { id: 'lazy', path: '/lazy', component: lazy(() => import('./pages/Lazy')), pending: () => <p role="status">Loading route…</p> },
] }]);

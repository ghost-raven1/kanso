import type { ReactNode } from '@kanso/core';
import { Link } from '@kanso/app';

export function Layout({ children }: { children?: ReactNode }) {
  return (
    <div className="shell">
      <header className="site-header">
        <Link href="/" class="brand">
          簡素 <span>Kanso studio</span>
        </Link>
        <span className="badge">0.6 · WEB DEMO</span>
      </header>
      <main>{children}</main>
      <footer>
        <p>React-shaped TSX · Solid · SSR</p>
        <p>
          Демо без оплаты. Заявки хранятся в памяти и исчезают при перезапуске.
        </p>
      </footer>
    </div>
  );
}

import { createContext, useState } from '@kanso/core';
import { defineRoutes, Link } from '@kanso/app';
import { Seo } from '@kanso/app/seo';
import { catalog, promotion } from './remotes';
import WorkersPanel from './WorkersPanel';

const Settings = createContext({ step: 1 });
const ProductCard = catalog.component('ProductCard');
const Banner = promotion.component('Banner');

function Home() {
  const [step, setStep] = useState(1);

  return (
    <Settings.Provider value={{ step }}>
      <Seo title="Independent pieces. One application." />
      <header>
        <span className="eyebrow">KANSO 0.6 · MICROFRONTENDS</span>
        <h1>
          Independent pieces.
          <br />
          One application.
        </h1>
        <p>Отдельные сборки. Общие Context, маршруты и серверный HTML.</p>
        <nav>
          <Link href="/catalog">Открыть удалённый каталог →</Link>
          <button
            id="step"
            onClick={() => setStep(value => (value === 1 ? 2 : 1))}
          >
            Шаг из оболочки: {step}
          </button>
        </nav>
      </header>
      <main className="cards">
        <ProductCard productId="camera" settings={Settings} />
        <ProductCard productId="lens" settings={Settings} />
      </main>
      <Banner message="Этот виджет приезжает из третьего приложения, со своим циклом выпуска." />
      <WorkersPanel />
      <footer>
        У каждой карточки своё состояние. Версия микрофронта закреплена для
        открытой страницы.
      </footer>
    </Settings.Provider>
  );
}

export const routes = defineRoutes([
  { id: 'home', path: '/', component: Home, sitemap: true },
  catalog.routes({ path: '/catalog' }),
]);

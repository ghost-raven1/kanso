import { App, readBootstrap, preloadRoute } from '@kanso/app';
import { mount, hydrateWhenReady } from '@kanso/core/client';
import { routes } from './routes';
import { seo } from './seo.config';
import './style.css';

window.kansoMetrics = { counterMounts: 0, rowMounts: 0, activeEffects: 0 };
const root = document.getElementById('root')!;
const bootstrap = readBootstrap(document, __KANSO_BUILD_ID__);
const render = () => <App routes={routes} seo={seo} bootstrap={bootstrap} />;
if (bootstrap) {
  const result = await hydrateWhenReady(async () => {
    await preloadRoute(routes, bootstrap.url);
    return { default: render };
  }, root);
  window.kansoReady = result.status === 'hydrated';
} else {
  mount(render, root);
  window.kansoReady = true;
}

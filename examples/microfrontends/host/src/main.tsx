import { App, readBootstrap } from '@kanso/app';
import { hydrateRoot, mount } from '@kanso/core/client';
import { prepareMicrofrontends } from '@kanso/microfrontends';
import { microfrontends } from './remotes';
import { routes } from './routes';
import { seo } from './seo';
import './style.css';

async function start() {
  const bootstrap = readBootstrap(
    document,
    import.meta.env.KANSO_HOST_BUILD_ID,
  );
  const session = await prepareMicrofrontends(
    microfrontends,
    bootstrap,
    routes,
  );
  const render = () => (
    <App
      routes={routes}
      seo={seo}
      bootstrap={bootstrap}
      microfrontends={microfrontends}
      microfrontendSession={session}
    />
  );
  const root = document.getElementById('root')!;
  if (bootstrap) hydrateRoot(render, root);
  else mount(render, root);
  document.documentElement.dataset.kansoReady = 'true';
}

function showLoadError(error: unknown) {
  console.error(error);
  const expired =
    error instanceof Error && 'status' in error && error.status === 409;
  const retry = document.createElement('button');
  retry.id = 'retry-hydration';
  retry.textContent = expired
    ? 'Этот выпуск больше недоступен. Обновить страницу'
    : 'Не удалось загрузить интерактивную часть. Повторить';
  retry.onclick = () => {
    if (expired) {
      location.reload();
      return;
    }
    retry.remove();
    void start().catch(showLoadError);
  };
  document.body.append(retry);
}

void start().catch(showLoadError);

import { App, readBootstrap } from '@kanso/app';
import { hydrateRoot, mount } from '@kanso/core/client';
import { routes } from './routes';
import { seo } from './seo.config';
const root = document.getElementById('root')!;
const bootstrap = readBootstrap(document, __KANSO_BUILD_ID__);
const render = () => <App routes={routes} seo={seo} bootstrap={bootstrap} />;
if (bootstrap) hydrateRoot(render, root);
else mount(render, root);

import './style.css';
document.documentElement.dataset.kansoReady = 'true';

import { App, readBootstrap } from '@kanso/app';
import { hydrateRoot } from '@kanso/core/client';
import { createServiceScope } from '@kanso/core';
import { routes, settings, trace, type State } from './app';

declare global {
  interface Window {
    readStore: () => State;
    trace: typeof trace;
    dispose: () => void;
    ready: boolean;
  }
}

const bootstrap = readBootstrap(document)!;
const scope = createServiceScope({ snapshots: bootstrap.services });
const dispose = hydrateRoot(
  () => <App routes={routes} bootstrap={bootstrap} services={scope} />,
  document.querySelector<HTMLElement>('#root')!,
);

window.readStore = () => scope.get(settings).getState();
window.trace = trace;
window.dispose = () => {
  dispose();
  scope.dispose();
};
window.ready = true;

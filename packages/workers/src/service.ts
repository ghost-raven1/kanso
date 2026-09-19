export type ServiceWorkerStatus = 'disabled' | 'unsupported' | 'idle' | 'registering' | 'installing' | 'ready' | 'update-available' | 'activating' | 'error' | 'disposed';

export interface ServiceWorkerSnapshot {
  status: ServiceWorkerStatus;
  registration?: ServiceWorkerRegistration;
  error?: unknown;
}

export interface ServiceWorkerOptions extends RegistrationOptions {
  /** Disable registration, for example when the Vite development worker is disabled. */
  enabled?: boolean;
}

export interface ServiceWorkerController {
  readonly state: Readonly<ServiceWorkerSnapshot>;
  /** Register explicitly. Repeated calls share the same pending registration. */
  register(): Promise<ServiceWorkerRegistration | undefined>;
  subscribe(listener: (state: Readonly<ServiceWorkerSnapshot>) => void): () => void;
  update(): Promise<void>;
  /** Request activation of a waiting worker. Does not reload or claim this document. */
  activateUpdate(): boolean;
  unregister(): Promise<boolean>;
  /** Remove this controller's listeners. The browser registration remains installed. */
  dispose(): void;
}

/** SSR-safe registration controller; no browser work happens before register(). */
export function createServiceWorker(url: string | URL | undefined, options: ServiceWorkerOptions = {}): ServiceWorkerController {
  const disabled = options.enabled === false || url === undefined;
  const supported = typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
  let snapshot: ServiceWorkerSnapshot = { status: disabled ? 'disabled' : supported ? 'idle' : 'unsupported' };
  let pending: Promise<ServiceWorkerRegistration | undefined> | undefined;
  let disposed = false;
  const listeners = new Set<(state: Readonly<ServiceWorkerSnapshot>) => void>();
  const cleanups: (() => void)[] = [];
  const watching = new Set<ServiceWorker>();
  const publish = (status: ServiceWorkerStatus, error?: unknown) => {
    snapshot = { status, ...(snapshot.registration ? { registration: snapshot.registration } : {}), ...(error !== undefined ? { error } : {}) };
    for (const listener of listeners) listener(snapshot);
  };
  const listen = (target: EventTarget, name: string, listener: EventListener) => {
    target.addEventListener(name, listener);
    cleanups.push(() => target.removeEventListener(name, listener));
  };
  const clear = () => { cleanups.splice(0).forEach(dispose => dispose()); watching.clear(); };
  const refresh = () => {
    if (disposed || !snapshot.registration) return;
    const registration = snapshot.registration;
    for (const worker of [registration.installing, registration.waiting, registration.active]) {
      if (!worker || watching.has(worker)) continue;
      watching.add(worker);
      listen(worker, 'statechange', () => {
        if (worker.state === 'redundant' && !registration.active) publish('error', new Error('Service worker installation failed.'));
        else refresh();
      });
    }
    if (registration.waiting) publish('update-available');
    else if (registration.installing) publish('installing');
    else if (registration.active?.state === 'activating') publish('activating');
    else if (registration.active?.state === 'activated') publish('ready');
  };
  return {
    get state() { return snapshot; },
    register() {
      if (disposed) return Promise.reject(new Error('This service worker controller has been disposed.'));
      if (disabled || !supported) return Promise.resolve(undefined);
      if (pending) return pending;
      if (snapshot.registration) return Promise.resolve(snapshot.registration);
      publish('registering');
      const { enabled: _enabled, ...registrationOptions } = options;
      pending = navigator.serviceWorker.register(String(url), { type: 'classic', updateViaCache: 'none', ...registrationOptions })
        .then(registration => {
          if (disposed) return registration;
          snapshot = { status: 'registering', registration };
          listen(registration, 'updatefound', refresh);
          listen(navigator.serviceWorker, 'controllerchange', refresh);
          refresh();
          return registration;
        })
        .catch(error => { if (!disposed) publish('error', error); throw error; })
        .finally(() => { pending = undefined; });
      return pending;
    },
    subscribe(listener) {
      if (!disposed) listeners.add(listener);
      listener(snapshot);
      return () => { listeners.delete(listener); };
    },
    async update() {
      if (disposed) throw new Error('This service worker controller has been disposed.');
      try { await snapshot.registration?.update(); }
      catch (error) { publish('error', error); throw error; }
    },
    activateUpdate() {
      const waiting = snapshot.registration?.waiting;
      if (disposed || !waiting) return false;
      waiting.postMessage({ type: 'kanso:activate-update' });
      publish('activating');
      return true;
    },
    async unregister() {
      if (disposed) return false;
      const registration = snapshot.registration ?? await pending;
      if (!registration) return false;
      const removed = await registration.unregister();
      if (removed && !disposed) {
        clear();
        snapshot = { status: 'idle' };
        publish('idle');
      }
      return removed;
    },
    dispose() {
      if (disposed) return;
      clear();
      disposed = true;
      publish('disposed');
      listeners.clear();
    },
  };
}

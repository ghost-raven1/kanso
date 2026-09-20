import * as solid from 'solid-js';
import * as web from 'solid-js/web';
import * as store from 'solid-js/store';
import * as core from '@kanso/core';
import * as internal from '@kanso/core/internal';
import * as client from '@kanso/core/client';
import * as app from '@kanso/app';
import * as integration from '@kanso/app/integration';
import * as seo from '@kanso/app/seo';
import * as router from '@kanso/app/solid-router';
import { RemoteError, RUNTIME_VERSIONS } from './manifest.js';

/** Factories supply the host's actual modules, including their Context identities. */
export function sharedModules(extra: Record<string, { version: string; module: object }> = {}) {
  const modules: Record<string, object> = { 'solid-js': solid, 'solid-js/web': web, 'solid-js/store': store, '@kanso/core': core, '@kanso/core/internal': internal, '@kanso/core/client': client, '@kanso/app': app, '@kanso/app/integration': integration, '@kanso/app/seo': seo, '@solidjs/router': router, '@kanso/app/solid-router': router };
  for (const name of Object.keys(extra)) if (Object.hasOwn(modules, name)) throw new RemoteError('MF_RESERVED_SHARED', `The host supplies ${name}; it cannot be replaced by a remote configuration.`);
  const version = (name: string) => Object.entries(RUNTIME_VERSIONS).find(([prefix]) => name === prefix || name.startsWith(prefix + '/'))?.[1] ?? '0.8.1';
  return Object.fromEntries(Object.entries({ ...Object.fromEntries(Object.entries(modules).map(([name, module]) => [name, { version: version(name), module }])), ...extra }).map(([name, value]) => [name, {
    version: value.version, lib: () => value.module,
    shareConfig: { singleton: true, requiredVersion: value.version, strictVersion: true },
  }]));
}
export type SharedModules = ReturnType<typeof sharedModules>;

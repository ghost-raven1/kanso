import type { Bootstrap } from './types.js';

/** JSON in an inert script must not terminate the surrounding HTML element. */
export function serialize(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export function readBootstrap(document: Document, expectedBuildId?: string): Bootstrap | undefined {
  const raw = document.getElementById('kanso-data')?.textContent;
  if (!raw) return undefined;
  const state = JSON.parse(raw) as Bootstrap;
  if (state.version !== 1 || typeof state.url !== 'string' || !state.data || typeof state.buildId !== 'string') throw new Error('Invalid Kanso bootstrap.');
  if (expectedBuildId && state.buildId !== expectedBuildId) throw new Error('Kanso server/client build mismatch.');
  return state;
}

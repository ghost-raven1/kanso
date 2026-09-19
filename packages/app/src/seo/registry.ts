import { createComponent, createContext, createEffect, createSignal, onCleanup, onMount, useContext } from 'solid-js';
import { isServer } from 'solid-js/web';
import { defineSeo, mergeSeo, resolveSeo } from './resolve.js';
import type { JsonLdData, SeoConfig, SeoMetadata, SeoProviderProps, SeoSnapshot } from './types.js';

export interface SeoLevel { id: string; metadata: SeoMetadata }
interface Entry { scope: string; kind: 'seo' | 'jsonld'; read: () => SeoMetadata }
export interface HeadRegistry {
  config: SeoConfig;
  setSource(source: () => { url: string; levels: SeoLevel[] } | undefined): void;
  register(entry: Entry): () => void;
  resolve(): SeoSnapshot | undefined;
}
export const HeadContext = createContext<HeadRegistry>();
export const SeoScopeContext = createContext('@root');

/** A collector is private to one application root or server request. */
export function createHeadRegistry(input: SeoConfig, url: () => string): HeadRegistry {
  const config = defineSeo(input);
  const entries = new Set<Entry>();
  const [revision, setRevision] = createSignal(0);
  let source = () => ({ url: url(), levels: [] as SeoLevel[] }) as { url: string; levels: SeoLevel[] } | undefined;
  return {
    config,
    setSource(next) { source = next; setRevision(value => value + 1); },
    register(entry) {
      // Capture SSR props now, while their owner and loader context are alive.
      const record = isServer ? { ...entry, read: (() => { const metadata = entry.read(); return () => metadata; })() } : entry;
      entries.add(record); setRevision(value => value + 1);
      return () => { entries.delete(record); setRevision(value => value + 1); };
    },
    resolve() {
      revision();
      const state = source();
      if (!state) return undefined;
      let result: SeoMetadata = config;
      const scopes = [{ id: '@root', metadata: {} }, ...state.levels];
      for (const scope of scopes) {
        result = mergeSeo(result, scope.metadata);
        const matches = [...entries].filter(entry => entry.scope === scope.id);
        if (matches.filter(entry => entry.kind === 'seo').length > 1) throw new Error(`KANSO_SEO_CONFLICT: route ${scope.id} has multiple active <Seo> components.`);
        const ids = new Set<string>();
        for (const entry of matches) {
          const metadata = entry.read();
          if (entry.kind === 'jsonld') for (const id of Object.keys(metadata.jsonLd ?? {})) {
            if (ids.has(id)) throw new Error(`KANSO_SEO_CONFLICT: route ${scope.id} repeats JsonLd id ${id}.`);
            ids.add(id);
          }
          result = mergeSeo(result, metadata);
        }
      }
      return resolveSeo(config, result, state.url);
    },
  };
}

/** Adopt SSR nodes by stable keys and change only framework-owned head entries. */
export function reconcileHead(document: Document, snapshot: SeoSnapshot): void {
  const nodes = new Map<string, Element>();
  for (const element of document.head.querySelectorAll('[data-kanso-head]')) {
    const key = element.getAttribute('data-kanso-head')!;
    if (nodes.has(key)) element.remove(); else nodes.set(key, element);
  }
  for (const tag of snapshot.tags) {
    let element = nodes.get(tag.key);
    nodes.delete(tag.key);
    if (element && element.tagName.toLowerCase() !== tag.tag) { element.remove(); element = undefined; }
    if (!element) { element = document.createElement(tag.tag); element.setAttribute('data-kanso-head', tag.key); document.head.appendChild(element); }
    for (const attr of [...element.attributes]) if (attr.name !== 'data-kanso-head' && !(attr.name in tag.attrs)) element.removeAttribute(attr.name);
    for (const [key, value] of Object.entries(tag.attrs)) if (element.getAttribute(key) !== value) element.setAttribute(key, value);
    if (tag.text !== undefined && element.textContent !== tag.text) element.textContent = tag.text;
  }
  for (const element of nodes.values()) element.remove();
  for (const key of ['lang', 'dir'] as const) {
    if (snapshot[key] === undefined) document.documentElement.removeAttribute(key);
    else document.documentElement.setAttribute(key, snapshot[key]!);
  }
}

/** App supplies this automatically; standalone applications wrap their own root. */
export function SeoProvider(props: SeoProviderProps & { /** @internal */ registry?: HeadRegistry }) {
  const inherited = useContext(HeadContext);
  const [location, setLocation] = createSignal(isServer ? '/' : window.location.pathname + window.location.search);
  const registry = props.registry ?? inherited ?? createHeadRegistry(props.config, () => props.url ?? location());
  if (!isServer && !inherited) {
    const original = { lang: document.documentElement.getAttribute('lang'), dir: document.documentElement.getAttribute('dir') };
    const update = () => setLocation(window.location.pathname + window.location.search);
    window.addEventListener('popstate', update);
    createEffect(() => { const snapshot = registry.resolve(); if (snapshot) reconcileHead(document, snapshot); });
    onCleanup(() => {
      window.removeEventListener('popstate', update);
      document.head.querySelectorAll('[data-kanso-head]').forEach(element => element.remove());
      for (const key of ['lang', 'dir'] as const) original[key] === null ? document.documentElement.removeAttribute(key) : document.documentElement.setAttribute(key, original[key]!);
    });
  }
  return createComponent(HeadContext.Provider, { value: registry, get children() { return props.children; } });
}

/** Reactive metadata override at the current route level, with automatic disposal. */
export function Seo(props: SeoMetadata): null {
  const registry = useContext(HeadContext);
  if (!registry) throw new Error('KANSO_SEO_PROVIDER: wrap the application in SeoProvider or configure App.seo.');
  registerOwned(registry, { scope: useContext(SeoScopeContext), kind: 'seo', read: () => ({ ...props }) });
  return null;
}
/** Several JSON-LD blocks may coexist when their IDs are distinct. */
export function JsonLd(props: { id: string; data: JsonLdData }): null {
  const registry = useContext(HeadContext);
  if (!registry) throw new Error('KANSO_SEO_PROVIDER: JsonLd requires SeoProvider.');
  registerOwned(registry, { scope: useContext(SeoScopeContext), kind: 'jsonld', read: () => ({ jsonLd: { [props.id]: props.data } }) });
  return null;
}

/** Suspended transition branches must not publish metadata before they commit. */
function registerOwned(registry: HeadRegistry, entry: Entry): void {
  if (isServer) { onCleanup(registry.register(entry)); return; }
  let dispose: (() => void) | undefined;
  onMount(() => { dispose = registry.register(entry); });
  onCleanup(() => dispose?.());
}

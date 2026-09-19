import { createContext, useContext, type JSX } from 'solid-js';
import type { Bootstrap, Route, RouteHandlers } from './types.js';

/** Immutable identities only: clients never choose executable server URLs. */
export interface RemotePin { buildId: string; manifest: string; modules: string[] }
export type RemotePins = Record<string, RemotePin>;
export interface RemoteSource {
  /** Trusted server manifest URL, with {buildId} replaced by a validated identity. */
  manifest?: string;
  /** Local Vite SSR loader; never populated from a browser request or production manifest. */
  development?: { buildId: string; load(name: string): Promise<unknown> };
}
export interface MicrofrontendOptions {
  definitions: readonly MicrofrontendDefinition[];
  pins?: RemotePins;
  sources?: Record<string, RemoteSource>;
  signal?: AbortSignal;
  timeoutMs?: number;
}
/** Optional integration port keeps federation out of applications that do not use it. */
export interface MicrofrontendSession {
  /** A required SSR widget failure must propagate beyond Solid's serialized boundary. */
  renderError?: Error;
  preparedRoutes?: Route[];
  prepare(routes: Route[], url: string, discovery?: boolean): Promise<Route[]>;
  load(remote: string, name: string): Promise<unknown>;
  preload(remote: string): Promise<void>;
  peek(remote: string, name: string): unknown;
  pins(): RemotePins;
  adopt(pins?: RemotePins): void;
  handlers: Record<string, RouteHandlers>;
  assets(): { styles: string[]; preloads: string[] };
  wrap(children: () => JSX.Element): JSX.Element;
  dispose(): void;
}
export interface MicrofrontendDefinition {
  name: string;
  manifest: string;
  contract: string;
  shared?: Record<string, { version: string; module: object }>;
  createSession(options: MicrofrontendOptions): MicrofrontendSession;
}
export const MicrofrontendContext = createContext<MicrofrontendSession>();
export const RouteScopeContext = createContext<{ prefix: string; namespace: string }>();
export const REMOTE_VERSIONS = '__kanso_remotes';

/** Internal route mounts use the same case and parameter rules as the host router. */
export function remoteMountPath(prefix: string, path: string): string {
  return '/' + [prefix, path].flatMap(value => value.split('/').filter(Boolean)).join('/');
}
export function remoteMountMatches(mount: string, pathname: string): boolean {
  const actual = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  return mount.split('/').filter(Boolean).every((part, i) => actual[i] !== undefined && (part.startsWith(':') || part.toLowerCase() === actual[i].toLowerCase()));
}

/** One session belongs to one app root or one server request. */
export function createMicrofrontendSession(definitions?: readonly MicrofrontendDefinition[], options: Omit<MicrofrontendOptions, 'definitions'> = {}): MicrofrontendSession | undefined {
  return definitions?.length ? definitions[0].createSession({ ...options, definitions }) : undefined;
}
export function useMicrofrontendSession(): MicrofrontendSession | undefined { return useContext(MicrofrontendContext); }
export function scopedRouteId(id: string): string {
  const scope = useContext(RouteScopeContext);
  return scope && !id.startsWith(scope.namespace) ? scope.namespace + id : id;
}
/** Headers carry pins through the same-origin data/action transport. */
export function remoteHeaders(session?: MicrofrontendSession): Record<string, string> {
  return session ? { 'X-Kanso-Remotes': JSON.stringify(session.pins()) } : {};
}
export function remoteSnapshot(bootstrap: Bootstrap, session?: MicrofrontendSession): Bootstrap {
  if (session) bootstrap.remotes = session.pins();
  return bootstrap;
}

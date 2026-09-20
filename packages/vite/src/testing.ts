import { compile } from '@kanso/compiler';
import type { Plugin } from 'vite';

/** Compile DOM tests and resolve one browser runtime in Vitest's jsdom environment. */
export default function kansoTesting(): Plugin {
  const runtime = [/^solid-js(?:\/|$)/, /^@kanso\/(?:core|app)(?:\/|$)/];
  return {
    name: 'kanso:testing',
    enforce: 'pre',
    config: () => ({
      resolve: { conditions: ['browser', 'development'], dedupe: ['solid-js', '@kanso/core', '@kanso/app', '@solidjs/router'] },
      ssr: { noExternal: runtime, resolve: { conditions: ['browser', 'development'] } },
      test: { environment: 'jsdom', server: { deps: { inline: runtime } } },
    }),
    transform(source, id) {
      if (/[/\\](?:node_modules|dist|dist-server)[/\\]/.test(id) || !/\.[jt]sx?(?:\?|$)/.test(id)) return;
      const result = compile(source, { filename: id.split('?')[0], generate: 'dom' });
      return { code: result.code, map: result.map ? JSON.stringify(result.map) : null };
    },
  };
}

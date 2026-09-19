# Microfrontend contracts in the CLI

Create a complete shell and remotes, or a standalone remote:

```bash
kanso create my-platform --template microfrontends
kanso create catalog --template remote
```

Both templates provide `dev`, `build`, `preview` and `typecheck` scripts. Existing
nonempty directories are refused. Use `--local /path/to/kanso` when developing
the framework; the generated project resolves all seven Kanso packages from that
workspace, including transitive dependencies that have not been published.

`kanso doctor --root . --json` inspects installed runtime versions, duplicate
shared packages and local configuration without starting servers or requesting
remote URLs. Use `microfrontends check` below for the separate network audit.

Declare remote sources in `kanso.microfrontends.json` at the application root:

```json
{
  "remotes": [
    {
      "name": "catalog",
      "manifest": "https://cdn.example.com/catalog/kanso-remote.json",
      "contract": "^1.0.0",
      "serverManifest": "https://internal.example.com/catalog/releases/{buildId}/kanso-server.json"
    }
  ]
}
```

`name` matches the remote build. `contract` is the supported semantic version
range; Kanso and Solid runtime versions must match exactly. `serverManifest` is
optional and is used only by the checker to inspect private artifacts. The CLI
substitutes the pinned release's build ID into `{buildId}`. It does not copy the
server URL into browser declarations or the lockfile, and it does not configure
the server's remote loader.

The file is JSON. The CLI never imports Vite configuration, application modules,
remote JavaScript or server handlers. Sources must use absolute HTTP(S) URLs
without embedded credentials. Private sources must be reachable from the machine
running the checker.

## Fetch typed contracts explicitly

```bash
kanso microfrontends sync --root .
kanso microfrontends check --root . --json
```

`sync` reads every current manifest, resolves its immutable release manifest,
checks runtime and contract compatibility, verifies referenced resources, and
downloads its declaration artifact. Each artifact has this transport format:

```json
{
  "schema": 1,
  "files": {
    "index.d.ts": "export type Contract = { /* generated component types */ };\n"
  }
}
```

Artifacts may include nested declaration files. `index.d.ts` must export a named
`Contract` type or interface. Absolute paths, traversal, symlinks and files other
than `.d.ts`, `.d.mts` and `.d.cts` are rejected.

The resulting files are:

```text
remote-types/
  catalog/
    index.d.ts
    ...other declarations
kanso-remotes.lock.json
```

Use the generated contract with the runtime API:

```ts
import { defineRemote } from '@kanso/microfrontends';
import type { Contract } from './remote-types/catalog';

export const catalog = defineRemote<Contract>({
  name: 'catalog',
  manifest: 'https://cdn.example.com/catalog/kanso-remote.json',
  contract: '^1.0.0',
});
```

Commit declarations and `kanso-remotes.lock.json` with the application. The lock
records each build ID, contract version, immutable manifest URL and type artifact
URL. Normal builds consume these local declarations; the checker does not
silently replace them when a remote releases an update.

When `kanso.microfrontends.json` is present, the Kanso Vite plugin requires a
valid local lock and each declaration entry before a production build. It also
checks that the locked contract version satisfies the configured range, without
network access. Use `check` for the separate availability and exact-content audit.

All remotes are checked before writing. A blocked sync leaves existing files
unchanged. Successful sync replaces only the configured remote declaration
directories and the lockfile, using staged files and rollback on commit failure.
Unrelated project files are preserved. Repeated sync against the same artifacts
produces identical contents.

## Check in CI

`check` is read-only. It verifies:

- Current and pinned manifest compatibility, unique exports and immutable build
  identities.
- Availability of entry scripts, CSS, preload resources and declaration
  artifacts. Assets are probed with `HEAD`; servers without `HEAD` support are
  checked using `GET`. JavaScript is never executed.
- Agreement between configured server and browser artifacts: build ID,
  contract, exports, routes and the server-only marker.
- Lockfile references and the exact installed declaration contents.

A newer compatible release can coexist with an older pinned type contract as
long as the old immutable artifacts remain available. Run `sync` explicitly to
adopt the new declarations. Missing old artifacts are reported instead of
silently switching releases.

Reports contain diagnostic codes, severity, a message, the affected remote and
an actionable hint. Exit status is `0` when there are no errors, `2` for invalid
configuration or unavailable/incompatible remote artifacts, and `1` when the
command itself cannot complete. Warnings, such as an unused lock entry, do not
block CI. JSON output uses the same diagnostics as the text report.

The programmatic API exports `syncMicrofrontends({ root? })` and
`checkMicrofrontends({ root? })`. Each returns `{ root, diagnostics, remotes,
written }`; `check` always returns an empty `written` array.

Для собственных общих контрактных пакетов добавьте к записи remote поле
`"shared": { "@company/contracts": "1.2.0" }`. Оно позволяет проверить точные
версии из манифеста без исполнения пакета; в приложении дополнительно передайте
сам namespace модуля через `defineRemote({ shared })`.

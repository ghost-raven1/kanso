import { readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative } from 'node:path';
import { createProjectResolver } from './resolver.js';
import { migrationEntries } from './entries.js';
import { runtimeImports } from './runtime-imports.js';
import type { createDependencyAudit } from './dependency-audit.js';

/** Doctor shares migration's source resolver, including aliases, barrels and local packages. */
export async function auditProjectImports(
  root: string,
  audit: ReturnType<typeof createDependencyAudit>,
  report: (file: string, error: unknown) => void,
  inspectConfig: (source: string, file: string) => string,
): Promise<void> {
  root = await realpath(root);
  const resolver = await createProjectResolver(root, { inspectConfig });
  const seen = new Set<string>();
  const visit = async (file: string): Promise<void> => {
    if (seen.has(file) || !/\.[cm]?[jt]sx?$/.test(file)) return;
    seen.add(file);
    const path = relative(root, file);
    if (path.startsWith('../') || path === '..' || isAbsolute(path))
      throw new Error(`Source ${file} is outside the audited project.`);
    try {
      for (const specifier of runtimeImports(
        await readFile(file, 'utf8'),
        path,
      )) {
        try {
          const target = await resolver.resolve(file, specifier);
          if (target) await visit(target);
          else if (specifier.startsWith('.'))
            throw new Error(`Cannot resolve ${specifier}.`);
          else if (
            ![
              'vite',
              '@vitejs/plugin-react',
              '@vitejs/plugin-react-swc',
            ].includes(specifier)
          )
            await audit.check(dirname(file), specifier);
        } catch (error) {
          report(path, error);
        }
      }
    } catch (error) {
      report(path, error);
    }
  };
  for (const file of await migrationEntries(
    root,
    resolver.entries,
    resolver.entryRoot,
  ))
    await visit(file);
}

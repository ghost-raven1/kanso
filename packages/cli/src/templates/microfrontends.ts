import { readFile } from 'node:fs/promises';
import { cliAsset, KANSO_PACKAGES, kansoPackageVersion } from '../packages.js';

interface TemplatePackage {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

/** Read a build-produced template; application configuration is never executed. */
export async function microfrontendFiles(
  template: 'microfrontends' | 'remote',
  local?: string,
  artifact = cliAsset('templates', 'microfrontends.json'),
): Promise<Record<string, string>> {
  const source: unknown = JSON.parse(await readFile(artifact, 'utf8'));
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('Invalid packaged microfrontends template. Rebuild @kanso/cli.');
  const files: Record<string, string> = {};
  for (const [path, contents] of Object.entries(source)) {
    if (typeof contents !== 'string' || path.includes('\\') || path.includes(':') || path.includes('\0') || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error(`Unsafe packaged template path: ${path}.`);
    if (template === 'remote' && !path.startsWith('catalog/')) continue;
    const target = template === 'remote' ? path.slice('catalog/'.length) : path;
    files[target] = contents;
  }
  if (!files['package.json']) throw new Error(`The packaged ${template} template has no package.json. Rebuild @kanso/cli.`);
  for (const [path, contents] of Object.entries(files)) {
    if (path !== 'package.json' && !path.endsWith('/package.json')) continue;
    const pkg = JSON.parse(contents) as TemplatePackage;
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies'] as const) {
      for (const name of Object.keys(pkg[field] ?? {})) {
        if (name.startsWith('@kanso/')) pkg[field]![name] = kansoPackageVersion(name.slice('@kanso/'.length), local);
      }
    }
    if (path === 'package.json') {
      pkg.scripts = { dev: 'node scripts/dev.mjs', build: 'node scripts/build.mjs', preview: 'node scripts/serve.mjs', typecheck: 'tsc --noEmit', ...pkg.scripts };
      if (local) {
        pkg.devDependencies ??= {};
        for (const name of KANSO_PACKAGES) {
          if (!pkg.dependencies?.[`@kanso/${name}`]) pkg.devDependencies[`@kanso/${name}`] = kansoPackageVersion(name, local);
        }
      }
    }
    files[path] = JSON.stringify(pkg, null, 2) + '\n';
  }
  files['.gitignore'] ??= 'node_modules/\ndist/\ndist-server/\n.env\n.env.*\n!.env.example\n';
  return files;
}

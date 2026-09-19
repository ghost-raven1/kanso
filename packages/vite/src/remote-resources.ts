import path from 'node:path';

interface OutputFile {
  type: string;
  fileName: string;
  facadeModuleId?: string | null;
  moduleIds?: string[];
  imports?: string[];
  dynamicImports?: string[];
}

/** Follow generated chunk edges without downloading unrelated exposed components. */
export function remoteResources(bundle: Record<string, OutputFile>, root: string, exposes: Record<string, string>, assetUrl: (file: string) => string): Record<string, string[]> {
  const chunks = Object.values(bundle).filter(file => file.type === 'chunk');
  const entry = chunks.find(file => file.fileName === 'remoteEntry.js');
  if (!entry) throw new Error('The federation build did not produce remoteEntry.js.');
  const sourceId = (file: string) => file.replaceAll('\\', '/').split('?')[0];
  const roots = Object.fromEntries(Object.entries(exposes).map(([name, source]) => {
    const id = sourceId(path.resolve(root, source));
    const chunk = chunks.find(file => sourceId(file.facadeModuleId ?? '') === id)
      ?? chunks.find(file => file.moduleIds?.some(module => sourceId(module) === id));
    if (!chunk) throw new Error(`Cannot locate the output chunk for remote export ${name}.`);
    return [name, chunk.fileName];
  }));
  const visit = (file: string, files: Set<string>) => {
    if (files.has(file) || bundle[file]?.type !== 'chunk') return;
    files.add(file);
    for (const dependency of bundle[file].imports ?? []) visit(dependency, files);
  };
  const common = new Set<string>();
  visit(entry.fileName, common);
  // Federation initializes this map dynamically before loading an expose. Other
  // dynamic imports are the exports themselves and stay scoped to their entry.
  for (const file of entry.dynamicImports ?? []) {
    const chunk = bundle[file];
    if (chunk?.moduleIds?.some(id => id.includes('localSharedImportMap')) || file.includes('localSharedImportMap')) visit(file, common);
  }
  return Object.fromEntries(Object.entries(roots).map(([name, file]) => {
    const files = new Set(common);
    visit(file, files);
    return [name, [...files].sort().map(assetUrl)];
  }));
}

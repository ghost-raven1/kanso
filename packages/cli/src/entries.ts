import { readFile, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

/** Read every external module entry in a local HTML entry without loading the page. */
export async function migrationEntries(
  root: string,
  selected: readonly string[] = ['index.html'],
  htmlRoot = root,
): Promise<string[]> {
  const entries = new Set<string>();
  for (const name of selected) {
    const file = await realpath(resolve(root, name));
    if (!file.endsWith('.html')) {
      if (!/\.[cm]?[jt]sx?$/.test(file))
        throw new Error(
          `ENTRY_TYPE: ${name} must be a JavaScript, TypeScript or HTML entry.`,
        );
      entries.add(file);
      continue;
    }
    const source = await readFile(file, 'utf8');
    let modules = 0;
    for (const match of source.matchAll(
      /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,
    )) {
      const attrs = match[1];
      if (!/\btype\s*=\s*['"]module['"]/i.test(attrs)) continue;
      const src = attrs.match(/\bsrc\s*=\s*['"]([^'"]+)['"]/i)?.[1];
      if (!src)
        throw new Error(
          `ENTRY_INLINE: ${name} contains an inline module; extract it to a source file before migration.`,
        );
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(src))
        throw new Error(
          `ENTRY_REMOTE: ${name} loads remote code that cannot be audited locally.`,
        );
      const path = src.split(/[?#]/)[0];
      entries.add(
        await realpath(
          path.startsWith('/')
            ? resolve(htmlRoot, path.slice(1))
            : resolve(dirname(file), path),
        ),
      );
      modules++;
    }
    if (!modules)
      throw new Error(
        `ENTRY: ${name} needs a static module script or select a source file with --entry.`,
      );
  }
  return [...entries];
}

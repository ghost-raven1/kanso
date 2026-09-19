import { readdir, readFile, writeFile } from 'node:fs/promises';
import { format } from 'prettier';
import { parse } from '@babel/parser';

const write = process.argv.includes('--write');
const options = { singleQuote: true, arrowParens: 'avoid', trailingComma: 'all' };
const files = [];
async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    // Downloaded contracts are checked byte-for-byte against the release artifact.
    if (['dist', 'dist-server', 'node_modules', 'public', 'remote-types'].includes(entry.name)) continue;
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await visit(path);
    else if (/\.(tsx?|mjs|css|html)$/.test(path)) files.push(path);
  }
}
await visit('examples/lab');
await visit('examples/catalog');
await visit('examples/microfrontends');
files.push('packages/cli/src/create.ts', 'packages/cli/src/templates/ssr.ts');
let failed = false;
for (const filepath of files) {
  let source = await readFile(filepath, 'utf8');
  // Keep emitted starter source formatted too, not just the template container.
  if (filepath.includes('packages/cli/')) {
    const ast = parse(source, { sourceType: 'module', plugins: ['typescript'] });
    const replacements = [];
    function walk(node) {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'ObjectProperty' && node.key.type === 'StringLiteral' && /\.(tsx?|mjs|html)$/.test(node.key.value) && node.value.type === 'TemplateLiteral' && node.value.expressions.length === 0) {
        const value = node.value.quasis[0].value.cooked;
        const formatted = format(value, { ...options, filepath: node.key.value });
        replacements.push({ start: node.value.start + 1, end: node.value.end - 1, formatted });
      }
      for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value === 'object') walk(value);
    }
    walk(ast);
    for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
      const content = (await replacement.formatted).replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${');
      source = source.slice(0, replacement.start) + content + source.slice(replacement.end);
    }
  }
  const result = await format(source, { ...options, filepath });
  const original = await readFile(filepath, 'utf8');
  if (result !== original) {
    if (write) await writeFile(filepath, result);
    else { console.error(`Formatting required: ${filepath}`); failed = true; }
  }
}
if (failed) process.exitCode = 1;
else console.log(`Examples and generated templates ${write ? 'formatted' : 'checked'} (${files.length} files).`);

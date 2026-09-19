import { readFile } from 'node:fs/promises';
import { parse } from '@babel/parser';
import * as t from '@babel/types';

const hookName = (name: string) => /^use[A-Z]/.test(name);
const identifier = (node: t.Identifier | t.StringLiteral) => t.isIdentifier(node) ? node.name : node.value;

/** Resolve only local, statically named hooks whose implementation is compiled in this graph. */
export function createHookAudit(root: string, resolver: (from: string, source: string) => Promise<string | undefined>) {
  const modules = new Map<string, Promise<t.Program>>();
  const contracts = new Map<string, Promise<boolean>>();
  const read = (file: string) => {
    let result = modules.get(file);
    if (!result) { result = readFile(file, 'utf8').then(source => parse(source, { sourceType: 'module', plugins: ['typescript','jsx'] }).program); modules.set(file, result); }
    return result;
  };
  const resolveLocal = async (file: string, source: string) => {
    const target = await resolver(file, source);
    return target && target.startsWith(root + '/') ? target : undefined;
  };
  const exported = async (file: string, name: string, seen = new Set<string>()): Promise<boolean> => {
    const key = `${file}:${name}`;
    if (seen.has(key)) return false;
    const trail = new Set([...seen, key]);
    const ast = await read(file);
    const local = async (name: string): Promise<boolean> => {
      for (const statement of ast.body) {
        const declaration = t.isExportNamedDeclaration(statement) || t.isExportDefaultDeclaration(statement) ? statement.declaration : statement;
        if (t.isFunctionDeclaration(declaration) && declaration.id?.name === name) return hookName(name);
        if (t.isVariableDeclaration(declaration)) {
          const binding = declaration.declarations.find(item => t.isIdentifier(item.id, { name }));
          if (binding) return hookName(name) && t.isFunction(binding.init);
        }
        if (t.isImportDeclaration(statement)) for (const specifier of statement.specifiers) {
          if (specifier.local.name !== name || t.isImportNamespaceSpecifier(specifier)) continue;
          const target = await resolveLocal(file, statement.source.value);
          return !!target && exported(target, t.isImportDefaultSpecifier(specifier) ? 'default' : identifier(specifier.imported), trail);
        }
      }
      return false;
    };
    for (const statement of ast.body) {
      if (name === 'default' && t.isExportDefaultDeclaration(statement)) {
        const value = statement.declaration;
        return t.isFunctionDeclaration(value) ? !!value.id && hookName(value.id.name) : t.isIdentifier(value) && local(value.name);
      }
      if (t.isExportNamedDeclaration(statement)) {
        const declaration = statement.declaration;
        if (t.isFunctionDeclaration(declaration) && declaration.id?.name === name) return hookName(name);
        if (t.isVariableDeclaration(declaration) && declaration.declarations.some(item => t.isIdentifier(item.id, { name }))) return local(name);
        for (const specifier of statement.specifiers) if (t.isExportSpecifier(specifier) && identifier(specifier.exported) === name) {
          if (!statement.source) return local(identifier(specifier.local));
          const target = await resolveLocal(file, statement.source.value);
          return !!target && exported(target, identifier(specifier.local), trail);
        }
      }
      if (t.isExportAllDeclaration(statement)) {
        const target = await resolveLocal(file, statement.source.value);
        if (target && await exported(target, name, trail)) return true;
      }
    }
    return false;
  };
  return async (file: string): Promise<Set<string>> => {
    const approved = new Set<string>();
    for (const statement of (await read(file)).body) {
      if (!t.isImportDeclaration(statement)) continue;
      for (const specifier of statement.specifiers) {
        if (t.isImportNamespaceSpecifier(specifier) || statement.importKind === 'type') continue;
        const name = t.isImportDefaultSpecifier(specifier) ? 'default' : identifier(specifier.imported);
        if (!hookName(name === 'default' ? specifier.local.name : name)) continue;
        const target = await resolveLocal(file, statement.source.value);
        if (!target) continue;
        const key = `${target}:${name}`;
        let valid = contracts.get(key);
        if (!valid) { valid = exported(target, name); contracts.set(key, valid); }
        if (await valid) approved.add(specifier.local.name);
      }
    }
    return approved;
  };
}

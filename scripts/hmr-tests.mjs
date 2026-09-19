import { mkdir, mkdtemp, writeFile as write, rename } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { chromium, firefox, webkit } from 'playwright';
import { createProject } from '@kanso/cli';
import { run, start, stop, viteArgs } from './test-project.mjs';
// Editors replace files atomically; do not let the watcher compile a truncated file.
async function writeFile(file, source) {
  const temporary = file + '.next';
  await write(temporary, source);
  await rename(temporary, file);
}
async function updateFile(page, file, source) {
  const settled = page.waitForEvent('console', { predicate: message => message.text().includes('[vite] hot updated: /src/App.tsx') });
  await writeFile(file, source);
  await settled;
  // Vite's watcher suppresses repeated change events for 50 ms on Linux.
  // Space simulated editor saves after acknowledgement, without weakening DOM assertions.
  await new Promise(resolve => setTimeout(resolve, 60));
}
await mkdir('output/hmr', { recursive: true });
const root = await mkdtemp(resolve('output/hmr/project-'));
await createProject(root, process.cwd());
run(root, 'npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--workspaces=false']);
const appSource = `import{useEffect,useReducer,useRef,useId}from'@kanso/core';import{useCounter}from'./useCounter';
function Counter(){const{count,increment}=useCounter();const[total,dispatch]=useReducer((n:number)=>n+1,0);const cache=useRef('seed');const field=useRef<HTMLInputElement|null>(null);const id=useId();
useEffect(()=>{window.trace.active++;return()=>{window.trace.active--;window.trace.cleanup++}},[]);
return <section><button data-count onClick={()=>{cache.current='kept';increment()}}>Count: {count}</button><button data-reducer onClick={()=>dispatch(undefined)}>Total: {total}</button><label htmlFor={id}>Input</label><input id={id} ref={field}/><button data-focus onClick={()=>field.current?.focus()}>Focus</button><span data-ref>{cache.current}</span></section>}
export function App(){return <main><Counter/><Counter/></main>}`;
const hookSource = `import{useState}from'@kanso/core';export function useCounter(){const[count,setCount]=useState(()=>{window.trace.initial++;return 0});const increment=()=>setCount(value=>value+1);return{count,increment}}`;
await writeFile(join(root, 'src/env.d.ts'), 'interface Window { trace: {initial:number;active:number;cleanup:number} }');
let server;
const results = [];
try {
  for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
    if (!(process.env.KANSO_BROWSERS ?? 'chromium,firefox,webkit').split(',').includes(name)) continue;
    await writeFile(join(root, 'src/App.tsx'), appSource); await writeFile(join(root, 'src/useCounter.ts'), hookSource);
    server = await start(root, viteArgs('', 4182), 4182);
    const browser = await engine.launch();
    const messages = [];
    const page = await browser.newPage();
    try {
      await page.addInitScript(() => { window.trace = { initial: 0, active: 0, cleanup: 0 }; });
      page.on('console', message => messages.push(message.text()));
      page.on('pageerror', error => messages.push(error.stack ?? error.message));
      await page.goto('http://127.0.0.1:4182'); await page.locator('[data-count]').first().click(); await page.locator('[data-count]').first().click(); await page.locator('[data-count]').last().click(); await page.locator('[data-reducer]').first().click();
      const ids = await page.locator('input').evaluateAll(nodes => nodes.map(node => node.id));
      await updateFile(page, join(root, 'src/App.tsx'), appSource.replace('Count:', 'Updated:'));
      await page.waitForFunction(() => document.querySelector('[data-count]')?.textContent === 'Updated: 2');
      assert.deepEqual(await page.locator('[data-count]').allTextContents(), ['Updated: 2', 'Updated: 1']);
      assert.deepEqual(await page.locator('[data-reducer]').allTextContents(), ['Total: 1', 'Total: 0']);
      assert.deepEqual(await page.locator('[data-ref]').allTextContents(), ['kept', 'kept']);
      assert.deepEqual(await page.locator('input').evaluateAll(nodes => nodes.map(node => node.id)), ids);
      await page.locator('[data-focus]').first().click(); assert.equal(await page.locator('input').first().evaluate(node => node === document.activeElement), true);
      assert.deepEqual(await page.evaluate(() => window.trace), { initial: 2, active: 2, cleanup: 2 });
      await updateFile(page, join(root, 'src/useCounter.ts'), hookSource.replace('value+1', 'value+2'));
      await page.waitForFunction(() => window.trace.cleanup === 4);
      await page.locator('[data-count]').first().click(); assert.equal(await page.locator('[data-count]').first().textContent(), 'Updated: 4');
      assert.equal(await page.evaluate(() => window.trace.initial), 2);
      await updateFile(page, join(root, 'src/App.tsx'), appSource.replace('Count:', 'Updated:').replace('(n:number)=>n+1', '(n:number)=>n+10'));
      await page.waitForFunction(() => window.trace.cleanup === 6);
      await page.locator('[data-reducer]').first().click();
      assert.equal(await page.locator('[data-reducer]').first().textContent(), 'Total: 11');
      await updateFile(page, join(root, 'src/useCounter.ts'), hookSource.replace('const increment', 'const[extra]=useState(9);const increment'));
      await page.waitForFunction(() => document.querySelector('[data-count]')?.textContent === 'Updated: 0');
      assert.equal(await page.evaluate(() => window.trace.initial), 4); assert.equal(messages.some(message => message.includes('state reset')), true);
      const valid = appSource.replace('Count:', 'Recovered:');
      await page.evaluate(() => { window.beforeCompileError = true; });
      await updateFile(page, join(root, 'src/App.tsx'), 'export function App( {');
      await page.waitForFunction(() => !!document.querySelector('vite-error-overlay'));
      assert.equal(await page.locator('[data-count]').count(), 2);
      await updateFile(page, join(root, 'src/App.tsx'), valid);
      await page.waitForFunction(() => document.querySelector('[data-count]')?.textContent === 'Recovered: 0');
      assert.equal(await page.evaluate(() => window.beforeCompileError), true, 'compiler recovery must not reload the page');
      assert.equal(await page.evaluate(() => window.trace.initial), 4, 'compiler recovery retains initialized state');
      await page.locator('[data-count]').last().click(); assert.equal(await page.locator('[data-count]').last().textContent(), 'Recovered: 1');
      assert.equal(await page.evaluate(() => window.trace.active), 2);
      // Removing a mounted child destroys its retained slots; a later mount initializes afresh.
      await updateFile(page, join(root, 'src/App.tsx'), valid.replace('<Counter/><Counter/>', '<Counter/>'));
      await page.waitForFunction(() => document.querySelectorAll('[data-count]').length === 1);
      await updateFile(page, join(root, 'src/App.tsx'), valid);
      await page.waitForFunction(() => document.querySelectorAll('[data-count]').length === 2);
      assert.deepEqual(await page.locator('[data-count]').allTextContents(), ['Recovered: 0', 'Recovered: 0']);
      assert.equal(await page.evaluate(() => window.trace.active), 2);
      const contextSource = `import{createContext,useContext,useState}from'@kanso/core';const Theme=createContext('light');function Label(){const value=useContext(Theme);return <p data-theme>Before: {value}</p>}export function App(){const[value,setValue]=useState('light');return <Theme.Provider value={value}><button onClick={()=>setValue('dark')}>Theme</button><Label/></Theme.Provider>}`;
      await updateFile(page, join(root, 'src/App.tsx'), contextSource);
      await page.getByRole('button', { name: 'Theme' }).click();
      await updateFile(page, join(root, 'src/App.tsx'), contextSource.replace('Before:', 'After:'));
      await page.waitForFunction(() => document.querySelector('[data-theme]')?.textContent === 'After: dark');
      const keyedSource = `import { useState } from '@kanso/core';
        function Row({ id }: { id: string }) {
          const [count, setCount] = useState(0);
          return <button data-key={id} onClick={() => setCount(n => n + 1)}>{id}: {count}</button>;
        }
        export function App() {
          const [ids, setIds] = useState(['A', 'B']);
          return <main><button data-reverse onClick={() => setIds(values => [...values].reverse())}>Reverse</button>
            {ids.map(id => <Row key={id} id={id} />)}
          </main>;
        }`;
      await updateFile(page, join(root, 'src/App.tsx'), keyedSource);
      await page.locator('[data-key="A"]').click();
      await page.locator('[data-key="A"]').click();
      await page.locator('[data-key="B"]').click();
      await page.locator('[data-reverse]').click();
      await updateFile(page, join(root, 'src/App.tsx'), keyedSource.replace('{id}:', '{id} updated:'));
      await page.waitForFunction(() => document.querySelector('[data-key]')?.textContent === 'B updated: 1');
      assert.deepEqual(await page.locator('[data-key]').allTextContents(), ['B updated: 1', 'A updated: 2']);
      results.push({ browser: name, context: true, keyed: true, jsx: true, hooks: true, reducer: true, refs: true, ids: true, isolation: true, cleanup: true, reset: true, errorRecovery: true, unmount: true });
      console.log(`Stateful HMR passed: ${name}`);
    } catch (error) {
      console.error('HMR failure:', name, { messages: messages.slice(-25), events: server.logs().split('\n').filter(line => /hmr|reload/.test(line)), server: server.logs().slice(-1500), html: (await page.content()).slice(-4000) });
      throw error;
    } finally { await browser.close(); }
    await stop(server); server = undefined;
  }
  for (const mode of ['remount', false]) {
    await writeFile(join(root, 'vite.config.ts'), `import kanso from '@kanso/vite';export default {plugins:[kanso({hmr:${JSON.stringify(mode)}})]};`);
    const source = `import {useState} from '@kanso/core';export function App(){const[count,setCount]=useState(0);return <button onClick={()=>setCount(n=>n+1)}>Before: {count}</button>}`;
    await writeFile(join(root, 'src/App.tsx'), source);
    server = await start(root, viteArgs('', 4182), 4182);
    for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
      if (!(process.env.KANSO_BROWSERS ?? 'chromium,firefox,webkit').split(',').includes(name)) continue;
      await writeFile(join(root, 'src/App.tsx'), source);
      const browser = await engine.launch();
      try {
        const page = await browser.newPage();
        await page.goto('http://127.0.0.1:4182');
        await page.getByRole('button').click();
        await page.evaluate(() => { window.beforeUpdate = true; });
        await writeFile(join(root, 'src/App.tsx'), source.replace('Before:', 'After:'));
        await page.waitForFunction(() => document.querySelector('button')?.textContent === 'After: 0');
        assert.equal(await page.evaluate(() => window.beforeUpdate === true), mode === 'remount');
        results.push({ browser: name, mode, reset: true, pageReload: mode === false });
      } finally { await browser.close(); }
    }
    await stop(server); server = undefined;
  }
  await writeFile('output/hmr/results.json', JSON.stringify(results, null, 2));
} finally { await stop(server); }

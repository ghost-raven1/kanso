import { afterEach, expect, it } from 'vitest';
import { compile } from '@kanso/compiler';
import { browserModule } from './helpers.js';
import { installDOM } from './dom-environment.js';

installDOM();
afterEach(() => {
  document.body.innerHTML = '';
});

const storeSource = `
function makeStore(initial) {
  let state=initial; const listeners=new Set();
  return {getState:()=>state,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)},
    set(next){state={...state,...next};for(const fn of listeners)fn()}, get size(){return listeners.size}};
}`;

it('selects values with equality, live selectors, snapshots and owner cleanup', async () => {
  const app = await browserModule<{
    run(root: HTMLElement): () => void;
    store: { set(value: unknown): void; size: number };
    trace: { bodies: number; effects: number; snapshots: number[] };
  }>(`
    import {useStore,useEffect,useState} from '@kanso/core';import{mount}from'@kanso/core/client';
    ${storeSource}
    export const store=makeStore({count:1,other:0});export const trace={bodies:0,effects:0,snapshots:[]};
    function Counter(){
      trace.bodies++;const [factor,setFactor]=useState(2);
      const value=useStore(store,state=>({count:state.count*factor}),(a,b)=>a.count===b.count);
      useEffect(()=>{trace.effects++},[value]);
      return <><output>{value.count}</output><button onClick={()=>setFactor(3)}>Factor</button>
        <button id="snapshot" onClick={()=>{const old=value.count;store.set({count:4});trace.snapshots.push(old)}}>Snapshot</button></>;
    }
    export const run=root=>mount(()=> <Counter/>,root);
  `);
  const dispose = app.run(document.body);
  expect(document.querySelector('output')!.textContent).toBe('2');
  expect(app.store.size).toBe(1);
  app.store.set({ other: 1 });
  expect(app.trace.effects).toBe(1);
  document.querySelector<HTMLButtonElement>('button')!.click();
  expect(document.querySelector('output')!.textContent).toBe('3');
  document.querySelector<HTMLButtonElement>('#snapshot')!.click();
  expect(app.trace.snapshots).toEqual([3]);
  expect(document.querySelector('output')!.textContent).toBe('12');
  expect(app.trace.bodies).toBe(1);
  dispose();
  expect(app.store.size).toBe(0);
});

it('switches stores, supports nested destructuring and ignores a released listener', async () => {
  const app = await browserModule<{
    run(root: HTMLElement): () => void;
    stores: { set(value: unknown): void; size: number }[];
  }>(`
    import{useStore,useState}from'@kanso/core';import{mount}from'@kanso/core/client';${storeSource}
    export const stores=[makeStore({nested:{count:1}}),makeStore({nested:{count:7}})];
    function Child(props){const {nested:{count}}=useStore(props.store);return <output>{count}</output>}
    function App(){const [index,setIndex]=useState(0);return <><button onClick={()=>setIndex(1)}>Switch</button><Child store={stores[index]}/></>}
    export const run=root=>mount(()=> <App/>,root);
  `);
  const dispose = app.run(document.body);
  expect(app.stores.map(store => store.size)).toEqual([1, 0]);
  document.querySelector<HTMLButtonElement>('button')!.click();
  expect(app.stores.map(store => store.size)).toEqual([0, 1]);
  app.stores[0].set({ nested: { count: 99 } });
  expect(document.querySelector('output')!.textContent).toBe('7');
  app.stores[1].set({ nested: { count: 8 } });
  expect(document.querySelector('output')!.textContent).toBe('8');
  dispose();
  expect(app.stores.map(store => store.size)).toEqual([0, 0]);
});

it('closes a registration race and makes stale notifications harmless', async () => {
  const app = await browserModule<{
    run(root: HTMLElement): () => void;
    late(): void;
    trace: { reads: number };
  }>(`
    import{useStore}from'@kanso/core';import{mount}from'@kanso/core/client';export const trace={reads:0};
    export let late;let value=1;
    const store={getState(){trace.reads++;return value},subscribe(listener){late=listener;value=2;return()=>{}}};
    function App(){const count=useStore(store);return <output>{count}</output>}
    export const run=root=>mount(()=> <App/>,root);
  `);
  const dispose = app.run(document.body);
  expect(document.querySelector('output')!.textContent).toBe('2');
  dispose();
  const reads = app.trace.reads;
  app.late();
  expect(app.trace.reads).toBe(reads);
});

it('checks store hooks by bindings and rejects conditional setup', () => {
  expect(() =>
    compile(
      `import{useStore}from'@kanso/core';function App({show,store}){if(show){const value=useStore(store)}return <p/>}`,
    ),
  ).toThrow('KANSO_HOOK_ORDER');
  expect(() =>
    compile(
      `import{useStore}from'@kanso/core';function App(){return <button onClick={()=>useStore({})}/>}`,
    ),
  ).toThrow('KANSO_HOOK_SCOPE');
  expect(() =>
    compile(
      `import{useStore}from'@kanso/core';function App(){const value=useStore();return <p>{value}</p>}`,
    ),
  ).toThrow('KANSO_STORE_ARGUMENT');
});

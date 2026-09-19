import { afterEach, expect, it } from 'vitest';
import { compile } from '@kanso/compiler';
import { browserModule, browserModules } from './helpers.js';
import { installDOM } from './dom-environment.js';

installDOM();
afterEach(() => { document.body.innerHTML = ''; });

it('keeps tuple results live across modules and barrel aliases without repeating setup', async () => {
  const app = await browserModules<{ run: (root: HTMLElement) => () => void; trace: { hooks: number; components: number; cleanup: number } }>({
    'counter.ts': `import {useState,useEffect} from '@kanso/core';export const trace={hooks:0,components:0,cleanup:0};
      export function useCounter(initial=1){trace.hooks++;const[n,setN]=useState(initial);const doubled=n*2;
      useEffect(()=>()=>{trace.cleanup++},[]);return [n,setN,doubled] as const}`,
    'index.ts': `export {useCounter as useCount,trace} from './counter';`,
    'App.tsx': `import{useCount as countHook,trace}from'./index';import{mount}from'@kanso/core/client';export{trace};
      function Counter(){trace.components++;const[n,setN,doubled]=countHook();return <button onClick={()=>setN(x=>x+1)}>{n}/{doubled}</button>}
      function App(){return <><Counter/><Counter/></>}export const run=root=>mount(()=> <App/>,root);`,
  });
  const dispose = app.run(document.body);
  const buttons = document.querySelectorAll('button'); buttons[0].click(); buttons[0].click();
  expect(buttons[0].textContent).toBe('3/6'); expect(buttons[1].textContent).toBe('1/2');
  expect(app.trace).toEqual({ hooks: 2, components: 2, cleanup: 0 }); dispose(); expect(app.trace.cleanup).toBe(2);
});

it('tracks live arguments, object results, scalar results and nested custom hooks', async () => {
  const app = await browserModules<{ run: (root: HTMLElement) => () => void }>({
    'hooks.ts': `import{useState}from'@kanso/core';
      function useScale(n,factor){return n*factor}
      export function useCounter(step){const[n,setN]=useState(0);const doubled=useScale(n,2);const increment=()=>setN(x=>x+step);return {count:n,doubled,increment}}
      export const useLabel=(n)=>'Count '+n;`,
    'App.tsx': `import{useState}from'@kanso/core';import{useCounter,useLabel}from'./hooks';import{mount}from'@kanso/core/client';
      function App(){const[step,setStep]=useState(1);const{count:n,increment,doubled}=useCounter(step);const label=useLabel(n);
        return <><button id="step" onClick={()=>setStep(3)}>step</button><button id="count" onClick={increment}>{label}/{doubled}</button></>}
      export const run=root=>mount(()=> <App/>,root);`,
  });
  const dispose = app.run(document.body);
  const count = document.querySelector<HTMLButtonElement>('#count')!;
  count.click(); expect(count.textContent).toBe('Count 1/2');
  document.querySelector<HTMLButtonElement>('#step')!.click(); count.click();
  expect(count.textContent).toBe('Count 4/8'); dispose();
});

it('preserves handler snapshots, function arguments and one-time defaults', async () => {
  const app = await browserModule<{ run: (root: HTMLElement) => () => void; trace: { defaults: number; argument: number; snapshots: number[] } }>(`
    import{useState,useMemo}from'@kanso/core';import{mount}from'@kanso/core/client';export const trace={defaults:0,argument:0,snapshots:[]};
    function useCounter(initial=(()=>{trace.defaults++;return 2})(),factory=()=>7){const[n,setN]=useState(initial);const staticValue=useMemo(()=>factory(),[]);return[n,setN,staticValue]}
    function App(){const[n,setN,extra]=useCounter();return <button onClick={()=>{const old=n;setN(x=>x+1);trace.snapshots.push(old)}}>{n}/{extra}</button>}
    export const run=root=>mount(()=> <App/>,root);
  `);
  const dispose = app.run(document.body); document.querySelector('button')!.click(); document.querySelector('button')!.click();
  expect(document.querySelector('button')!.textContent).toBe('4/7');
  expect(app.trace.defaults).toBe(1); expect(app.trace.snapshots).toEqual([2,3]); dispose();
});

it('rejects impure returned calculations, conditional setup and unsafe patterns', () => {
  expect(()=>compile(`export function useBad(n){return unknown(n)}`)).toThrow('KANSO_HOOK_RESULT_PURITY');
  expect(()=>compile(`function useN(){return 1}function App({show}){if(show){const n=useN()}return <p/>}`)).toThrow('KANSO_HOOK_ORDER');
  expect(()=>compile(`export function useN(...args){return args[0]}`)).toThrow('KANSO_HOOK_PARAMETER');
  expect(()=>compile(`export function useN(n){if(n)return 1;return 2}`)).toThrow('KANSO_HOOK_RETURN');
  expect(()=>compile(`import{useN}from'./hook';const alias=useN;`)).toThrow('KANSO_HOOK_REFERENCE');
  expect(()=>compile(`function useN(n){return arguments[0]}`)).toThrow('KANSO_HOOK_PARAMETER');
  expect(()=>compile(`function useN(){return this.value}`)).toThrow('KANSO_HOOK_PARAMETER');
  expect(()=>compile(`function useN(){return 1}function App({show}){show && useN();return <p/>}`)).toThrow('KANSO_HOOK_ORDER');
  expect(()=>compile(`import{useEffect}from'@kanso/core';function useN(show){show && useEffect(()=>{},[]);return 1}`)).toThrow('KANSO_HOOK_ORDER');
});

it('keeps object-argument fields reactive and rejects an uncompiled runtime contract', async () => {
  const app=await browserModule<{run:(root:HTMLElement)=>()=>void}>(`
    import{useState}from'@kanso/core';import{mount}from'@kanso/core/client';
    function useLabel(options){const{label}=options;return label.toUpperCase()}
    function App(){const[options,setOptions]=useState({label:'first'});const label=useLabel(options);return <button onClick={()=>setOptions({label:'next'})}>{label}</button>}
    export const run=root=>mount(()=> <App/>,root);
  `);
  const dispose=app.run(document.body);document.querySelector('button')!.click();expect(document.querySelector('button')!.textContent).toBe('NEXT');dispose();
  const invalid=await browserModule<{run:(root:HTMLElement)=>()=>void}>(`
    import{__callHook}from'@kanso/core/internal';import{mount}from'@kanso/core/client';
    function App(){__callHook(()=>[0,()=>{}],[]);return <p/>}export const run=root=>mount(()=> <App/>,root);
  `);
  expect(()=>invalid.run(document.body)).toThrow('KANSO_HOOK_ABI');
});

it('preserves liveness through alternating derived expressions and custom calls', async () => {
  const app=await browserModule<{run:(root:HTMLElement)=>()=>void; setups:number}>(`
    import{useState}from'@kanso/core';import{mount}from'@kanso/core/client';export let setups=0;
    function useDouble(n){setups++;return n*2}
    function App(){const[n,setN]=useState(0);const first=n+1;const doubled=useDouble(first);const next=doubled+1;const result=useDouble(next);
      return <button onClick={()=>setN(x=>x+1)}>{result}</button>}
    export const run=root=>mount(()=> <App/>,root);
  `);
  const dispose=app.run(document.body);const button=document.querySelector('button')!;
  expect(button.textContent).toBe('6');button.click();expect(button.textContent).toBe('10');
  expect(app.setups).toBe(2);dispose();
});

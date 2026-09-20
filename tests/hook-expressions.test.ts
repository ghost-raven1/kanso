import { afterEach, expect, it } from 'vitest';
import { compile } from '@kanso/compiler';
import { migrateSource } from '@kanso/cli';
import { browserModule, browserModules } from './helpers.js';
import { installDOM } from './dom-environment.js';

installDOM();
afterEach(() => {
  document.body.innerHTML = '';
});

it('keeps direct hook returns and member reads live across module boundaries', async () => {
  const app = await browserModules<{
    run(root: HTMLElement): () => void;
    setups: number;
  }>({
    'hooks.ts': `import {createContext,useContext,useCallback} from '@kanso/core';
        export const Settings=createContext({profile:{name:'default'}});
        export const useName=()=>useContext(Settings).profile?.name as string;
        export const useLabel=()=>useName();
        export function useAction(name){return useCallback(()=>name,[name])}`,
    'App.tsx': `import {useState} from '@kanso/core';import {mount} from '@kanso/core/client';
        import {Settings,useLabel,useAction} from './hooks';export let setups=0;
        function Label(){setups++;const name=useLabel();const action=useAction(name);return <><output>{name}</output><button id="read" onClick={()=>document.title=action()}>read</button></>}
        function App(){const[value,setValue]=useState({profile:{name:'first'}});return <><button id="next" onClick={()=>setValue({profile:{name:'next'}})}>next</button><Settings.Provider value={value}><Label/></Settings.Provider></>}
        export const run=root=>mount(()=> <App/>,root);`,
  });
  const dispose = app.run(document.body);
  expect(document.querySelector('output')!.textContent).toBe('first');
  document.querySelector<HTMLButtonElement>('#next')!.click();
  document.querySelector<HTMLButtonElement>('#read')!.click();
  expect(document.querySelector('output')!.textContent).toBe('next');
  expect(document.title).toBe('next');
  expect(app.setups).toBe(1);
  dispose();
});

it('destructures memo objects and tuples with reactive defaults and rest', async () => {
  const app = await browserModule<{
    run(root: HTMLElement): () => void;
    setups: number;
  }>(`
    import {useState,useMemo} from '@kanso/core';import {mount} from '@kanso/core/client';export let setups=0;
    function App(){setups++;const [n,setN]=useState(0);
      const {profile:{name='fallback'},...rest}=useMemo(()=>({profile:{name:n===0?undefined:n===1?null:'ready'},extra:n}),[n]);
      const [first,,...tail]=useMemo(()=>[n,n+1,n+2,n+3],[n]);
      return <button onClick={()=>setN(v=>v+1)}>{name===null?'null':name}/{rest.extra}/{first}/{tail.join(',')}</button>;
    }export const run=root=>mount(()=> <App/>,root);
  `);
  const dispose = app.run(document.body);
  const button = document.querySelector('button')!;
  expect(button.textContent).toBe('fallback/0/0/2,3');
  button.click();
  expect(button.textContent).toBe('null/1/1/3,4');
  button.click();
  expect(button.textContent).toBe('ready/2/2/4,5');
  expect(app.setups).toBe(1);
  dispose();
});

it('preserves setup evaluation order in multi-declarator initializers', async () => {
  const app = await browserModule<{
    run(root: HTMLElement): () => void;
    trace: string[];
  }>(`
    import {useMemo} from '@kanso/core';import {mount} from '@kanso/core/client';export const trace=[];
    function useEntry(){trace.push('hook');return {name:'entry'}}
    function App(){const before=trace.push('before'),name=useEntry().name,after=trace.push('after');
      return <p>{name}</p>}
    export const run=root=>mount(()=> <App/>,root);
  `);
  const dispose = app.run(document.body);
  expect(app.trace).toEqual(['before', 'hook', 'after']);
  expect(document.querySelector('p')!.textContent).toBe('entry');
  dispose();
});

it('migrates direct returns and memo patterns without changing source structure', () => {
  const result = migrateSource(
    `import {createContext,useContext,useMemo} from 'react';
    const Settings=createContext({enabled:true});export const useEnabled=()=>useContext(Settings).enabled;
    export function App(){const {label}=useMemo(()=>({label:'ready'}),[]);return <p>{label}</p>}`,
    'App.tsx',
  );
  expect(result.diagnostics).toEqual([]);
  expect(result.code).toContain('useContext(Settings).enabled');
  expect(migrateSource(result.code, 'App.tsx').code).toBe(result.code);
});

it('returns state tuples, refs and effect-only hooks without repeating setup', async () => {
  const app = await browserModule<{
    run(root: HTMLElement): () => void;
    trace: string[];
  }>(`
    import {useState,useReducer,useRef,useEffect} from '@kanso/core';import {mount} from '@kanso/core/client';export const trace=[];
    const useCounter=()=>useState(0);
    const useField=()=>useRef(null);
    const useMounted=()=>useEffect(()=>{trace.push('mount');return ()=>trace.push('cleanup')},[]);
    const useModel=()=>useReducer((state)=>({name:state.name+'!'}),{name:'first'});
    function App(){const[count,setCount]=useCounter();const[{name},dispatch]=useModel();const field=useField();useMounted();
      return <button ref={field} onClick={()=>{setCount(v=>v+1);dispatch()}}>{count}/{name}</button>}
    export const run=root=>mount(()=> <App/>,root);
  `);
  const dispose = app.run(document.body);
  const button = document.querySelector('button')!;
  expect(button.textContent).toBe('0/first');
  button.click();
  expect(button.textContent).toBe('1/first!');
  expect(app.trace).toEqual(['mount']);
  dispose();
  expect(app.trace).toEqual(['mount', 'cleanup']);
});

it('destructures nested state values and sparse reducer tuples', async () => {
  const app = await browserModule<{ run(root: HTMLElement): () => void }>(`
    import {useState,useReducer} from '@kanso/core';import {mount} from '@kanso/core/client';
    function App(){const[{name,...rest},setUser]=useState({name:'first',age:1});const[,dispatch]=useReducer((n)=>n+1,0);
      return <button onClick={()=>{setUser({name:'next',age:2});dispatch()}}>{name}/{rest.age}</button>}
    export const run=root=>mount(()=> <App/>,root);
  `);
  const dispose = app.run(document.body);
  const button = document.querySelector('button')!;
  expect(button.textContent).toBe('first/1');
  button.click();
  expect(button.textContent).toBe('next/2');
  dispose();
});

it('initializes refs from live values once, including destructured ref snapshots', async () => {
  const app = await browserModule<{
    run(root: HTMLElement): () => void;
    calls: number;
  }>(`
    import {useState,useRef} from '@kanso/core';import {mount} from '@kanso/core/client';export let calls=0;
    function serialize(value){calls++;return JSON.stringify(value)}
    function App(){const[value,setValue]=useState({name:'first'});const baseline=useRef(serialize(value));const{current}=useRef(value.name);
      return <button onClick={()=>setValue({name:'next'})}>{value.name}/{baseline.current}/{current}</button>}
    export const run=root=>mount(()=> <App/>,root);
  `);
  const dispose = app.run(document.body);
  const button = document.querySelector('button')!;
  button.click();
  expect(button.textContent).toBe('next/{"name":"first"}/first');
  expect(app.calls).toBe(1);
  dispose();
});

it('keeps scalar component returns reactive without adding wrapper DOM', async () => {
  const app = await browserModule<{ run(root: HTMLElement): () => void; setups: number }>(`
    import {useState,useMemo,useContext,createContext} from '@kanso/core';import {mount} from '@kanso/core/client';export let setups=0;
    const Settings=createContext({name:'first'});
    function Name(){setups++;return useContext(Settings).name}
    const Count=({value})=>useMemo(()=>value*2,[value]);
    function App(){const[value,setValue]=useState(0);return <button onClick={()=>setValue(v=>v+1)}><Settings.Provider value={{name:value===0?'first':'next'}}><Name/></Settings.Provider>/<Count value={value}/></button>}
    export const run=root=>mount(()=> <App/>,root);
  `);
  const dispose = app.run(document.body);
  const button = document.querySelector('button')!;
  expect(button.textContent).toBe('first/0');
  button.click(); expect(button.textContent).toBe('next/2');
  expect(button.children).toHaveLength(0);
  expect(app.setups).toBe(1);
  dispose();
});

it.each([
  `function useValue(flag){return flag ? useContext(Settings) : null}`,
  `function useValue(flag){if(flag)return useContext(Settings);return null}`,
  `function useValue(){return [before(),useContext(Settings)]}`,
  `function useValue(){return combine(before(),useContext(Settings))}`,
  `function useValue(){return ()=>useContext(Settings)}`,
])('rejects conditional or ambiguous hook expressions: %s', source => {
  expect(() =>
    compile(
      `import {createContext,useContext} from '@kanso/core';const Settings=createContext(0);${source}`,
    ),
  ).toThrow(/KANSO_HOOK_(?:ORDER|BINDING|SCOPE)/);
});

it('leaves ordinary shadowed functions untouched', () => {
  expect(() =>
    compile(
      `import {useContext} from '@kanso/core';function ordinary(useContext){return useContext().value}`,
    ),
  ).not.toThrow();
});

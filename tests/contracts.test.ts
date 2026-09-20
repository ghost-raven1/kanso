import { afterEach, expect, it } from 'vitest';
import { browserModule } from './helpers.js';
import { compile } from '@kanso/compiler';
import { installDOM } from './dom-environment.js';
installDOM();
afterEach(() => { document.body.innerHTML = ''; });

it('reacts to terminal early returns and local props destructuring', async () => {
  const app = await browserModule<{ run: (root: HTMLElement) => () => void }>(`
    import {useState} from '@kanso/core';import {mount} from '@kanso/core/client';
    function Child(props){const {n=0,...rest}=props; if(n>1) return <output {...rest}>large {n}</output>; return <output>small {n}</output>}
    function App(){const[n,setN]=useState(0);return <><button onClick={()=>setN(x=>x+1)}>next</button><Child n={n} data-live="yes"/></>}
    export const run=root=>mount(()=> <App/>,root);
  `);
  const dispose = app.run(document.body);
  document.querySelector('button')!.click();
  expect(document.querySelector('output')!.textContent).toBe('small 1');
  document.querySelector('button')!.click();
  expect(document.querySelector('output')!.textContent).toBe('large 2');
  expect(document.querySelector('output')!.dataset.live).toBe('yes');
  dispose();
});

it('normalizes native spread props, tracks them, and clears object refs', async () => {
  const app = await browserModule<{ run: (root: HTMLElement) => () => void; ref: { current: HTMLInputElement | null } }>(`
    import {useState,useRef} from '@kanso/core';import {mount} from '@kanso/core/client';export let ref;
    function App(){const[n,setN]=useState('one');ref=useRef(null);return <><input {...{ref,className:n,style:{paddingTop:7},value:n,onChange:e=>setN(e.currentTarget.value)}}/><output>{n}</output></>}
    export const run=root=>mount(()=> <App/>,root);
  `);
  const dispose = app.run(document.body);
  const input = document.querySelector('input')!;
  expect(input.style.paddingTop).toBe('7px'); expect(input.className).toBe('one'); expect(app.ref.current).toBe(input);
  input.value = 'two'; input.dispatchEvent(new Event('input', { bubbles: true }));
  expect(document.querySelector('output')!.textContent).toBe('two'); expect(input.className).toBe('two');
  dispose(); expect(app.ref.current).toBe(null);
});

it('uses Object.is and lazy state initialization, and supports reducers', async () => {
  const app = await browserModule<{ run: (root: HTMLElement) => () => void; trace: { init: number; effects: number } }>(`
    import {useState,useEffect,useReducer} from '@kanso/core';import {mount} from '@kanso/core/client';export const trace={init:0,effects:0};
    function App(){const[n,setN]=useState(()=>{trace.init++;return NaN});const [sum,dispatch]=useReducer((n,a)=>n+a,0);
    useEffect(()=>{trace.effects++},[n]);return <><button id="same" onClick={()=>setN(NaN)}>same</button><button id="add" onClick={()=>dispatch(2)}>{sum}</button></>}
    export const run=root=>mount(()=> <App/>,root);
  `);
  const dispose = app.run(document.body);
  document.querySelector<HTMLButtonElement>('#same')!.click(); document.querySelector<HTMLButtonElement>('#add')!.click();
  expect(app.trace).toEqual({ init: 1, effects: 1 }); expect(document.querySelector('#add')!.textContent).toBe('2'); dispose();
});

it('effect cleanup precedes reruns, explicit dependencies ignore other reads', async () => {
  const app = await browserModule<{ run: (root: HTMLElement) => () => void; trace: string[] }>(`
    import {useState,useEffect} from '@kanso/core';import {mount} from '@kanso/core/client';export const trace=[];
    function App(){const[a,setA]=useState(0);const[b,setB]=useState(0);
    useEffect(()=>{trace.push('run:'+a+':'+b);return ()=>trace.push('clean')},[a]);
    return <><button id="a" onClick={()=>setA(x=>x+1)}>a</button><button id="b" onClick={()=>setB(x=>x+1)}>b</button></>}
    export const run=root=>mount(()=> <App/>,root);
  `);
  const dispose = app.run(document.body);
  document.querySelector<HTMLButtonElement>('#b')!.click(); expect(app.trace).toEqual(['run:0:0']);
  document.querySelector<HTMLButtonElement>('#a')!.click(); dispose();
  expect(app.trace).toEqual(['run:0:0', 'clean', 'run:1:1', 'clean']);
});

it('accepts keyed block returns and rejects unknown purity and unsafe list setup', () => {
  expect(compile('export function App({items}){return <ul>{items.map(item=>{return <li key={item.id}>{item.name}</li>})}</ul>}').code).toContain('__Keyed');
  expect(() => compile('export function App({items}){return <ul>{items.map(item=>{const x=unknown(item);return <li key={item.id}>{x}</li>})}</ul>}')).toThrow('KANSO_LIST_BODY');
  expect(() => compile("import{useState}from'@kanso/core';function App(){const[n]=useState(0);const x=n+unknown();return <p>{x}</p>}")).toThrow('KANSO_PURITY');
  expect(() => compile("import{useState}from'@kanso/core';function App(){const[n]=useState(0);const x=n+Math.random();return <p>{x}</p>}")).toThrow('KANSO_PURITY');
});

it('keeps store derivations and replaced event handlers live', async () => {
  const app = await browserModule<{ run: (root: HTMLElement) => () => void }>(`
    import {createStore,useState} from '@kanso/core';import {mount} from '@kanso/core/client';
    function App(){const[store,setStore]=createStore({n:1});const doubled=store.n*2;const[mode,setMode]=useState(false);
      return <><button id="mode" onClick={()=>setMode(true)}>mode</button><button id="write" onClick={mode?()=>setStore('n',3):()=>setStore('n',2)}>write</button><output>{doubled}</output></>}
    export const run=root=>mount(()=> <App/>,root);
  `);
  const dispose=app.run(document.body);
  document.querySelector<HTMLButtonElement>('#write')!.click(); expect(document.querySelector('output')!.textContent).toBe('4');
  document.querySelector<HTMLButtonElement>('#mode')!.click(); document.querySelector<HTMLButtonElement>('#write')!.click();
  expect(document.querySelector('output')!.textContent).toBe('6'); dispose();
});

it('initializes reducers lazily and provides reactive objects through context', async () => {
  const app = await browserModule<{ run: (root: HTMLElement) => () => void; initializations: number }>(`
    import{useReducer,createContext,useContext,createStore}from'@kanso/core';import{mount}from'@kanso/core/client';
    export let initializations=0;const C=createContext();
    function Child(){const {label}=useContext(C);return <output>{label}</output>}
    function App(){const[n,dispatch]=useReducer((n,a)=>n+a,2,n=>{initializations++;return n*3});const[s,setS]=createStore({label:'first'});
      return <C.Provider value={s}><button onClick={()=>{dispatch(1);setS('label','next')}}>{n}</button><Child/></C.Provider>}
    export const run=root=>mount(()=> <App/>,root);
  `);
  const dispose=app.run(document.body); expect(document.querySelector('button')!.textContent).toBe('6');
  document.querySelector('button')!.click(); expect(document.querySelector('button')!.textContent).toBe('7');
  expect(document.querySelector('output')!.textContent).toBe('next'); expect(app.initializations).toBe(1); dispose();
});

it('diagnoses conditional hooks and supports value-shaped custom hook results', () => {
  expect(()=>compile("import{useState}from'@kanso/core';function App({show}){if(show){const[n]=useState(0)}return <p/>}")).toThrow('KANSO_HOOK_ORDER');
  expect(compile("import{useState}from'@kanso/core';function useCounter(){const[n,setN]=useState(0);return [n,setN]}").code).toContain('__hookResult');
});

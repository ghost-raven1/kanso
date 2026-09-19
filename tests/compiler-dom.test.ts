import { afterEach, describe, expect, it } from 'vitest';
import { browserModule } from './helpers.js';
import { compile } from '@kanso/compiler';
import { installDOM } from './dom-environment.js';

installDOM();

afterEach(() => { document.body.innerHTML = ''; });
const tick = () => new Promise<void>(resolve => queueMicrotask(resolve));

describe('compiled TSX execution', () => {
  it('updates bindings without rerunning either component body, and batches effects', async () => {
    const app = await browserModule<{ run: (root: HTMLElement) => () => void; trace: { body: number; other: number; effects: number[]; cleanup: number[] } }>(`
      import {useState,useEffect} from '@kanso/core';
      import {mount} from '@kanso/core/client';
      export const trace={body:0,other:0,effects:[],cleanup:[]};
      function Other(){ trace.other++; return <aside>Independent</aside>; }
      function Counter(){
        trace.body++;
        const [count,setCount]=useState(0); const double=count*2;
        useEffect(()=>{ const snapshot=count; trace.effects.push(snapshot); return ()=>trace.cleanup.push(snapshot); },[count]);
        return <><button onClick={()=>{setCount(n=>n+1);setCount(n=>n+1)}}>{count}/{double}</button><Other/></>;
      }
      export const run=(root)=>mount(()=> <Counter/>,root);
    `);
    const dispose = app.run(document.body);
    const button = document.querySelector('button')!;
    expect(button.textContent).toBe('0/0');
    button.click();
    expect(button.textContent).toBe('2/4');
    expect(app.trace).toEqual({ body: 1, other: 1, effects: [0, 2], cleanup: [0] });
    dispose();
    expect(app.trace.cleanup).toEqual([0, 2]);
  });

  it('keeps destructured props, defaults, rest and derived values reactive', async () => {
    const app = await browserModule<{ run: (root: HTMLElement) => () => void }>(`
      import {useState} from '@kanso/core'; import {mount} from '@kanso/core/client';
      function Child({value=10,...rest}){ const doubled=value*2; return <output {...rest}>{doubled}</output>; }
      function App(){ const [value,setValue]=useState(2); return <><button onClick={()=>setValue(n=>n+1)}>Next</button><Child value={value} data-testid="child"/></>; }
      export const run=(root)=>mount(()=> <App/>,root);
    `);
    const dispose = app.run(document.body);
    expect(document.querySelector('output')!.textContent).toBe('4');
    document.querySelector('button')!.click();
    expect(document.querySelector('output')!.textContent).toBe('6');
    expect(document.querySelector('output')!.dataset.testid).toBe('child');
    dispose();
  });

  it('preserves keyed row state and nodes when objects are replaced and reordered', async () => {
    const app = await browserModule<{ run: (root: HTMLElement) => () => void }>(`
      import {useState} from '@kanso/core'; import {mount} from '@kanso/core/client';
      function Row({item}){ const [count,setCount]=useState(0); return <li data-id={item.id}><input value={item.label}/><button onClick={()=>setCount(n=>n+1)}>{count}</button></li>; }
      function App(){ const [items,setItems]=useState([{id:'a',label:'Alpha'},{id:'b',label:'Beta'}]);
        return <><button id="reverse" onClick={()=>setItems([{id:'b',label:'Beta2'},{id:'a',label:'Alpha2'}])}>Reverse</button><ul>{items.map(item=><Row key={item.id} item={item}/>)}</ul></>;
      }
      export const run=(root)=>mount(()=> <App/>,root);
    `);
    const dispose = app.run(document.body);
    const row = document.querySelector('[data-id="a"]')!;
    row.querySelector('button')!.click();
    const input = row.querySelector('input')!; input.focus();
    document.querySelector<HTMLButtonElement>('#reverse')!.click();
    await tick();
    expect(document.querySelectorAll('li')[1]).toBe(row);
    expect(input.value).toBe('Alpha2');
    expect(row.querySelector('button')!.textContent).toBe('1');
    expect(document.activeElement).toBe(input);
    dispose();
  });

  it('supports live callbacks, snapshot locals, auto effects and memo dependencies', async () => {
    const app = await browserModule<{ run: (root: HTMLElement) => () => void; read: () => number; snapshot: () => number; trace: number[] }>(`
      import {useState,useEffect,useMemo,useCallback} from '@kanso/core'; import {mount} from '@kanso/core/client';
      export let read; export let snapshot; export const trace=[];
      function App(){ const [n,setN]=useState(0); const value=useMemo(()=>n*3,[n]); const fn=useCallback(()=>n,[]);
        useEffect(()=>{trace.push(n)});
        read=fn;
        return <button onClick={()=>{const previous=n; snapshot=()=>previous;setN(x=>x+1)}}>{value}</button>;
      }
      export const run=root=>mount(()=> <App/>,root);
    `);
    const dispose = app.run(document.body);
    document.querySelector('button')!.click();
    expect(app.read()).toBe(1); expect(app.snapshot()).toBe(0);
    expect(document.querySelector('button')!.textContent).toBe('3');
    expect(app.trace).toEqual([0, 1]); dispose();
  });

  it('supports styles, refs and controlled React-style onChange', async () => {
    const app = await browserModule<{ run: (root: HTMLElement) => () => void }>(`
      import {useState,useRef,useEffect} from '@kanso/core'; import {mount} from '@kanso/core/client';
      function App(){const [text,setText]=useState('a');const ref=useRef(null);useEffect(()=>{ref.current.focus()},[]);
        return <><label htmlFor="field">Text</label><input id="field" ref={ref} className="field" style={{marginTop:8,opacity:0.5}} value={text} onChange={e=>setText(e.currentTarget.value)}/><output>{text}</output></>;
      } export const run=root=>mount(()=> <App/>,root);
    `);
    const dispose = app.run(document.body);
    const input = document.querySelector('input')!;
    expect(document.activeElement).toBe(input);
    expect(input.style.marginTop).toBe('8px'); expect(input.className).toBe('field');
    input.value = 'updated'; input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.querySelector('output')!.textContent).toBe('updated'); dispose();
  });
});

describe('compiler diagnostics', () => {
  it('requires stable keys and rejects unknown impure derived calls', () => {
    expect(() => compile(`export function App({items}){return <ul>{items.map(item=><li>{item}</li>)}</ul>}`)).toThrow('KANSO_LIST_KEY');
    expect(() => compile(`import {useState} from '@kanso/core';function App(){const [n]=useState(0);const x=unknown(n);return <p>{x}</p>}`)).toThrow('KANSO_PURITY');
  });
  it('does not transform another function named useState or shadowed callback parameters', () => {
    const result = compile(`function useState(n){return [n,()=>{}]} export function App(){ const [n]=useState(1);return <p>{[2].map(n=>n*2)}{n}</p>}`).code;
    expect(result).not.toContain('__state');
  });
});

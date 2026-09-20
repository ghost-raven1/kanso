import { afterEach, expect, it } from 'vitest';
import { compile } from '@kanso/compiler';
import { browserModule } from './helpers.js';
import { installDOM } from './dom-environment.js';
installDOM();
afterEach(() => { document.body.innerHTML = ''; });

it('runs layout effects after refs/DOM attachment, before effects, and cleans callback refs', async () => {
  const app = await browserModule<{ run(root: HTMLElement): () => void; trace: unknown[] }>(`
    import {useState,useRef,useEffect,useLayoutEffect} from '@kanso/core';
    import {mount} from '@kanso/core/client';
    export const trace=[];
    function Child(){
      const ref=useRef(); const [n,setN]=useState(0);
      useEffect(()=>{trace.push('effect:'+n)},[n]);
      useLayoutEffect(()=>{trace.push('layout:'+ref.current.textContent+':'+ref.current.isConnected);return ()=>trace.push('clean:'+n)},[n]);
      return <button ref={element=>{ref.current=element;trace.push(element?'ref':'null')}} onClick={()=>setN(v=>v+1)}>{n}</button>;
    }
    export const run=root=>mount(()=> <Child/>,root);
  `);
  const dispose = app.run(document.body);
  expect(app.trace).toEqual(['ref', 'layout:0:true', 'effect:0']);
  document.querySelector('button')!.click();
  expect(app.trace.slice(-3)).toEqual(['clean:1', 'layout:1:true', 'effect:1']);
  dispose();
  expect(app.trace.filter(value => value === 'null')).toHaveLength(1);
});

it('forwards object/callback refs, refreshes handles and clears them on owner cleanup', async () => {
  const app = await browserModule<{ run(root: HTMLElement): () => void; trace: unknown[]; handle: { current: { value: number; focus(): void } | null } }>(`
    import {forwardRef,useImperativeHandle,useRef,useState} from '@kanso/core';
    import {mount} from '@kanso/core/client';
    export const trace=[]; export const handle={current:null};
    const Field=forwardRef(({value},ref)=>{
      const input=useRef(null);
      useImperativeHandle(ref,()=>({value,focus:()=>input.current.focus()}),[value]);
      return <input ref={input} value={value}/>;
    });
    function App(){const [n,setN]=useState(1); return <><button onClick={()=>setN(v=>v+1)}>next</button><Field ref={handle} value={n}/><Field ref={value=>trace.push(value?.value??null)} value={n}/></>}
    export const run=root=>mount(()=> <App/>,root);
  `);
  const dispose = app.run(document.body);
  expect(app.handle.current?.value).toBe(1);
  app.handle.current!.focus();
  expect(document.activeElement).toBe(document.querySelector('input'));
  document.querySelector('button')!.click();
  expect(app.handle.current?.value).toBe(2);
  expect(app.trace).toEqual([1, null, 2]);
  dispose();
  expect(app.handle.current).toBeNull();
  expect(app.trace).toEqual([1, null, 2, null]);
});

it('keeps list patterns and pure setup reactive across replacement, reorder and local snapshots', async () => {
  const app = await browserModule<{ run(root: HTMLElement): () => void; read(): string }>(`
    import {useState} from '@kanso/core';import {mount} from '@kanso/core/client';export let read;
    function App(){const [items,setItems]=useState([{id:'a',data:{title:'alpha'},extra:'A'},{id:'b',data:{title:'beta'}}]);
      const ready=Boolean(items.length);
      return <><button onClick={()=>setItems([{id:'b',data:{title:'BETA'}},{id:'a',data:{title:'changed'},extra:'A2'}])}>swap</button><output>{String(ready)}</output>
        <ul>{items.map(({id,data:{title='default'},...rest},index)=>{const details={title};const {title:text}=details;const label=text.toUpperCase();const position=index+1;return <li key={id} data-id={id}><input value={label}/><span>{position}/{rest.extra}</span><button onClick={()=>{const snapshot=label;read=()=>snapshot}}>snapshot</button></li>})}</ul></>;
    } export const run=root=>mount(()=> <App/>,root);
  `);
  const dispose=app.run(document.body);
  const row=document.querySelector('[data-id="a"]')!;
  const input=row.querySelector('input')!;
  row.querySelector('button')!.click(); input.focus();
  document.querySelector('button')!.click();
  await new Promise<void>(resolve => queueMicrotask(resolve));
  expect(document.querySelectorAll('li')[1]).toBe(row);
  expect(input.value).toBe('CHANGED');
  expect(row.querySelector('span')!.textContent).toBe('2/A2');
  expect(document.activeElement).toBe(input);
  expect(app.read()).toBe('ALPHA');
  dispose();
});

it('still rejects side effects in rows and shadowed conversion functions', () => {
  expect(()=>compile(`function App({items}){return <>{items.map(item=>{console.log(item);return <p key={item.id}/>})}</>}`)).toThrow(/KANSO_LIST_BODY/);
  expect(()=>compile(`function App({value,Boolean}){const converted=Boolean(value);return <p>{converted}</p>}`)).toThrow(/KANSO_PURITY/);
});


it('keeps imperative handles when invalidation produces the same dependencies', async () => {
  const app = await browserModule<{run(root: HTMLElement):()=>void; trace: unknown[]}>(`
    import {useState,useImperativeHandle} from '@kanso/core';import {mount} from '@kanso/core/client';export const trace=[];
    function App(){const [n,setN]=useState(0);const ref=value=>trace.push(value?.kind??null);
      useImperativeHandle(ref,()=>({kind:'handle'}),[n%2]);
      return <button onClick={()=>setN(v=>v+2)}>same</button>;
    }export const run=root=>mount(()=> <App/>,root);
  `);
  const dispose=app.run(document.body);document.querySelector('button')!.click();
  expect(app.trace).toEqual(['handle']);dispose();expect(app.trace).toEqual(['handle',null]);
});


it('rejects forwardRef renderers whose implicit function bindings would change', () => {
  for (const source of [
    `const Field=forwardRef(function(props,ref){return arguments[0].children})`,
    `const Field=forwardRef(function(props,ref){return this.children})`,
    `const Field=forwardRef(function render(props,ref){return render(props,ref)})`,
    `const Field=forwardRef((props,ref)=><input/>,extra())`,
  ]) expect(()=>compile(`import {forwardRef} from '@kanso/core';${source}`)).toThrow(/KANSO_FORWARD_REF/);
});

it('runs layout effects after conditionally inserted DOM and before ordinary effects', async () => {
  const app=await browserModule<{run(root:HTMLElement):()=>void;trace:string[]}>(`
    import {useState,useRef,useLayoutEffect,useEffect} from '@kanso/core';import {mount} from '@kanso/core/client';export const trace=[];
    function Field(){const ref=useRef(null);const[n,setN]=useState(0);
      useEffect(()=>{trace.push('effect:'+n)},[n]);
      useLayoutEffect(()=>{trace.push('layout:'+ref.current.isConnected+':'+ref.current.textContent)},[n]);
      return <button ref={ref} onClick={()=>setN(v=>v+1)}>{n}</button>;
    }
    function App(){const[visible,setVisible]=useState(false);return <><button id="mount" onClick={()=>setVisible(v=>!v)}>toggle</button>{visible&&<Field/>}</>}
    export const run=root=>mount(()=> <App/>,root);
  `);
  const dispose=app.run(document.body);
  document.querySelector<HTMLButtonElement>('#mount')!.click();
  expect(app.trace).toEqual(['layout:true:0','effect:0']);
  document.querySelectorAll('button')[1].click();
  expect(app.trace.slice(-2)).toEqual(['layout:true:1','effect:1']);
  dispose();
});

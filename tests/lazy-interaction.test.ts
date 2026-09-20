import { afterEach, expect, it, vi } from 'vitest';
import { renderToString } from 'solid-js/web';
import { createComponent } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { lazy } from '@kanso/core';
import { browserModule } from './helpers.js';
import { installDOM } from './dom-environment.js';
import type { RenderResult } from '@kanso/core/testing';

installDOM();
afterEach(() => document.body.replaceChildren());

it('renders the supplied shell without importing the interactive component on the server', () => {
  let imports = 0;
  const Control = lazy(async () => { imports++; return { default: () => 'interactive' }; }, {
    interaction: { fallback: () => createComponent(Dynamic, { component: 'button', children: 'Ready shell' }) },
  });
  expect(renderToString(() => createComponent(Control, {}))).toContain('Ready shell');
  expect(imports).toBe(0);
});

it('loads once on interaction, keeps the shell while pending, restores input and replays the first click once', async () => {
  const app = await browserModule<{ start(): RenderResult; release(): void; trace: { imports: number; mounts: number } }>(`
    import {lazy,useState} from '@kanso/core';import {render} from '@kanso/core/testing';
    export const trace={imports:0,mounts:0};let resolve;const gate=new Promise(done=>resolve=done);export const release=()=>resolve();
    function Shell({id}){return <section><input id={id+'-input'}/><button id={id}>Count: 0</button></section>}
    function Control({id}){trace.mounts++;const[count,setCount]=useState(0);const[value,setValue]=useState('');return <section><input id={id+'-input'} value={value} onInput={event=>setValue(event.currentTarget.value)}/><button id={id} onClick={()=>setCount(n=>n+1)}>Count: {count}</button><output>{value}</output></section>}
    const Deferred=lazy(async()=>{trace.imports++;await gate;return {default:Control}},{interaction:{fallback:Shell,pending:()=> <p>Custom pending</p>}});
    export const start=()=>render(()=> <><Deferred id="first"/><Deferred id="second"/></>);
  `);
  const view = app.start();
  expect(app.trace).toEqual({ imports: 0, mounts: 0 });
  const input = document.querySelector<HTMLInputElement>('#first-input')!;
  input.value = 'typed before import';
  document.querySelector<HTMLButtonElement>('#first')!.click();
  await vi.waitFor(() => expect(app.trace.imports).toBe(1));
  expect(document.querySelector('#first-input')).toBe(input);
  expect(document.body.textContent).toContain('Custom pending');
  app.release();
  await vi.waitFor(() => expect(document.querySelector('#first')?.textContent).toBe('Count: 1'));
  expect(document.querySelector('output')?.textContent).toBe('typed before import');
  document.querySelector('#second')!.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
  await vi.waitFor(() => expect(app.trace.mounts).toBe(2));
  expect(app.trace.imports).toBe(1);
  expect(document.querySelector('#second')?.textContent).toBe('Count: 0');
  view.unmount();
});

it('uses a custom retry view and never mounts a module after its owner leaves', async () => {
  const app = await browserModule<{ start(): RenderResult; release(): void; trace: { calls: number; mounts: number } }>(`
    import {lazy} from '@kanso/core';import {render} from '@kanso/core/testing';
    export const trace={calls:0,mounts:0};let resolve;const gate=new Promise(done=>resolve=done);export const release=()=>resolve();
    function Loaded(){trace.mounts++;return <button id="control">loaded</button>}
    const Deferred=lazy(async()=>{trace.calls++;if(trace.calls===1)throw Error('offline');await gate;return {default:Loaded}},{interaction:{fallback:()=> <button id="control">shell</button>,error:({retry})=> <button onClick={retry}>Try again</button>}});
    export const start=()=>render(()=> <Deferred/>);
  `);
  const view = app.start();
  document.querySelector<HTMLButtonElement>('#control')!.click();
  await vi.waitFor(() => expect(document.body.textContent).toContain('Try again'));
  [...document.querySelectorAll('button')].find(button => button.textContent === 'Try again')!.click();
  await vi.waitFor(() => expect(app.trace.calls).toBe(2));
  view.unmount(); app.release();
  await new Promise(resolve => setTimeout(resolve, 40));
  expect(app.trace.mounts).toBe(0);
  expect(document.body.childNodes).toHaveLength(0);
});

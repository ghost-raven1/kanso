import { afterEach, expect, it } from 'vitest';
import { createRoot } from 'solid-js';
import { transition } from '../packages/core/src/transition.js';
import { browserModule } from './helpers.js';
import { installDOM } from './dom-environment.js';

installDOM();
afterEach(() => document.body.replaceChildren());

it('runs server updates synchronously without evaluating animation targets', () => {
  createRoot(dispose => {
    const [pending, start] = transition({ animation: { target() { throw Error('browser only'); }, enter: [{ opacity: 0 }] } });
    let calls = 0;
    void start(() => { calls++; });
    expect(calls).toBe(1); expect(pending()).toBe(false); dispose();
  });
});

it('compiles pending as a live value, runs only the latest queued update and stops on cleanup', async () => {
  const app = await browserModule<{ start(): { transition(value: number): Promise<void>; dispose(): void }; trace: { setups: number } }>(`
    import {useState,useTransition} from '@kanso/core';import {render} from '@kanso/core/testing';
    export const trace={setups:0};let change;
    function App(){trace.setups++;const[count,setCount]=useState(0);const[pending,start]=useTransition();change=value=>start(()=>setCount(value));return <output>{pending?'pending':'ready'}:{count}</output>}
    export function start(){const view=render(()=> <App/>);return {transition:value=>change(value),dispose:view.unmount}}
  `);
  const view = app.start();
  const first = view.transition(1), second = view.transition(2);
  expect(document.querySelector('output')?.textContent).toBe('pending:0');
  await Promise.all([first, second]);
  expect(document.querySelector('output')?.textContent).toBe('ready:2');
  expect(app.trace.setups).toBe(1);
  const late = view.transition(3); view.dispose(); await late;
  expect(document.body.childNodes).toHaveLength(0);
});

it('recovers after a throwing update and accepts destructured hook results', async () => {
  const app = await browserModule<{ start(): { run(fail: boolean): Promise<void>; dispose(): void } }>(`
    import {useTransition,useState} from '@kanso/core';import {render} from '@kanso/core/testing';let execute;
    function App(){const transition=useTransition();const[pending,start]=transition;const[n,setN]=useState(0);execute=fail=>start(()=>{if(fail)throw Error('failed');setN(1)});return <output>{pending?'pending':'ready'}:{n}</output>}
    export function start(){const view=render(()=> <App/>);return {run:fail=>execute(fail),dispose:view.unmount}}
  `);
  const view = app.start();
  await expect(view.run(true)).rejects.toThrow('failed');
  await view.run(false);
  expect(document.querySelector('output')?.textContent).toBe('ready:1');
  view.dispose();
});

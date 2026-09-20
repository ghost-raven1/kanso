import { afterEach, expect, it } from 'vitest';
import { renderToString } from 'solid-js/web';
import { Portal } from '@kanso/core';
import { render } from '@kanso/core/testing';
import type { ComponentRenderResult, RenderResult } from '@kanso/core/testing';
import { browserModule } from './helpers.js';
import { installDOM } from './dom-environment.js';

installDOM();
afterEach(() => { document.body.replaceChildren(); });

it('never evaluates portal targets or children on the server', () => {
  expect(renderToString(() => Portal({
    mount: () => { throw new Error('browser only'); },
    get children(): never { throw new Error('browser only child'); },
  }))).toBe('');
  expect(() => render(() => null)).toThrow(/KANSO_TEST_ENVIRONMENT/);
});

it('keeps Context, component state and DOM when a live portal target changes', async () => {
  const app = await browserModule<{
    start(): ComponentRenderResult<{ target: HTMLElement | null; name: string }>;
    trace: { setups: number; cleanups: number; ref: { current: HTMLInputElement | null } };
  }>(`
    import {Portal,createContext,useContext,useState,useRef,onCleanup} from '@kanso/core';
    import {renderComponent} from '@kanso/core/testing';
    export const trace={setups:0,cleanups:0,ref:null};const Name=createContext('default');
    function Field(){trace.setups++;const name=useContext(Name);const[n,setN]=useState(0);const ref=useRef(null);trace.ref=ref;onCleanup(()=>trace.cleanups++);
      return <label>{name}<input ref={ref}/><button onClick={()=>setN(v=>v+1)}>{n}</button></label>;
    }
    function App({target,name}){return <Name.Provider value={name}><Portal mount={()=>target}><Field/></Portal></Name.Provider>}
    export const start=()=>renderComponent(App,{props:{target:null,name:'alpha'}});
  `);
  const first = document.createElement('section'), second = document.createElement('section');
  document.body.append(first, second);
  const view = app.start();
  expect(app.trace.setups).toBe(0);
  view.setProps({ target: first });
  const input = first.querySelector('input')!;
  expect(input).not.toBeNull();
  input.value = 'draft'; first.querySelector('button')!.click();
  view.setProps({ target: second, name: 'beta' });
  expect(first.childNodes).toHaveLength(0);
  expect(second.querySelector('input')).toBe(input);
  expect(second.textContent).toBe('beta1');
  expect(input.value).toBe('draft');
  expect(app.trace.setups).toBe(1);
  view.setProps({ target: null });
  expect(second.childNodes).toHaveLength(0);
  expect(app.trace.cleanups).toBe(1);
  expect(app.trace.ref.current).toBeNull();
  view.setProps({ target: second });
  expect(second.textContent).toBe('beta0');
  expect(app.trace.setups).toBe(2);
  view.unmount(); view.unmount();
  expect(second.childNodes).toHaveLength(0);
  expect(app.trace.cleanups).toBe(2);
});

it('updates nested, optional and callback props without resetting state or setup', async () => {
  const app = await browserModule<{
    start(): ComponentRenderResult<{ title?: string | null; details: { n: number }; onChange: () => void }>;
    trace: { setups: number; calls: string[] };
  }>(`
    import {useState} from '@kanso/core';import {renderComponent} from '@kanso/core/testing';
    export const trace={setups:0,calls:[]};
    function Counter({title='fallback',details:{n},onChange}){trace.setups++;const[count,setCount]=useState(0);
      return <button onClick={()=>{setCount(v=>v+1);onChange()}}>{title}/{n}/{count}</button>;
    }
    export const start=()=>renderComponent(Counter,{props:{title:'one',details:{n:1},onChange:()=>trace.calls.push('first')}});
  `);
  const view = app.start();
  const button = view.container.querySelector('button')!;
  button.click();
  view.setProps({ title: undefined, details: { n: 2 }, onChange: () => app.trace.calls.push('second') });
  button.click();
  expect(button.textContent).toBe('fallback/2/2');
  expect(app.trace).toEqual({ setups: 1, calls: ['first', 'second'] });
  view.setProps({ title: null });
  expect(button.textContent).toBe('/2/2');
  view.unmount();
  expect(() => view.setProps({ title: 'late' })).toThrow(/KANSO_TEST_UNMOUNTED/);
});

it('owns wrappers, services and portals per scope and preserves caller containers', async () => {
  const app = await browserModule<{
    start(container?: HTMLElement): { view: RenderResult; cleanup(): void };
    trace: { disposed: number };
  }>(`
    import {Portal,ServiceProvider,createServiceScope,defineService,useService,onCleanup} from '@kanso/core';
    import {createTestScope} from '@kanso/core/testing';
    export const trace={disposed:0};
    const service=defineService({id:'test.service',create({onCleanup}){onCleanup(()=>trace.disposed++);return {name:'service'}}});
    function Child(){const data=useService(service);return <Portal><output>{data.name}</output></Portal>}
    function Wrapper(props){const scope=createServiceScope();onCleanup(()=>scope.dispose());return <ServiceProvider scope={scope}>{props.children}</ServiceProvider>}
    export function start(container){const scope=createTestScope();return {view:scope.render(()=> <Child/>,{container,wrapper:Wrapper}),cleanup:scope.cleanup}}
  `);
  const container = document.createElement('section'); document.body.append(container);
  const first = app.start(container), second = app.start();
  expect(first.view.baseElement.querySelectorAll('output')).toHaveLength(2);
  first.cleanup();
  expect(container.isConnected).toBe(true);
  expect(container.childNodes).toHaveLength(0);
  expect(document.querySelectorAll('output')).toHaveLength(1);
  expect(app.trace.disposed).toBe(1);
  second.cleanup(); second.cleanup();
  expect(second.view.container.isConnected).toBe(false);
  expect(document.querySelectorAll('output')).toHaveLength(0);
  expect(app.trace.disposed).toBe(2);
});

it('cleans failed mounts and all remaining roots even when a cleanup throws', async () => {
  const app = await browserModule<{ fail(): void; cleanup(): void; mount(): void; trace: string[] }>(`
    import {onCleanup} from '@kanso/core';import {createTestScope,render} from '@kanso/core/testing';
    export const trace=[];const scope=createTestScope();
    export function fail(){render(()=>{onCleanup(()=>trace.push('failed'));throw Error('setup failed')})}
    export function mount(){scope.render(()=>{onCleanup(()=>{trace.push('first');throw Error('cleanup failed')});return 'first'});scope.render(()=>{onCleanup(()=>trace.push('second'));return 'second'})}
    export const cleanup=scope.cleanup;
  `);
  expect(() => app.fail()).toThrow('setup failed');
  expect(document.body.childNodes).toHaveLength(0);
  app.mount();
  expect(() => app.cleanup()).toThrow('Test cleanup failed');
  expect(app.trace).toEqual(['failed', 'first', 'second']);
  expect(document.body.childNodes).toHaveLength(0);
  expect(() => app.cleanup()).not.toThrow();
});

it('refuses a nonempty target before modifying it', async () => {
  const app = await browserModule<{ start(container: HTMLElement): void }>(`
    import {render} from '@kanso/core/testing';export const start=container=>render(()=> 'replacement',{container});
  `);
  const container = document.createElement('div'); container.textContent = 'existing';
  expect(() => app.start(container)).toThrow(/KANSO_TEST_CONTAINER/);
  expect(container.textContent).toBe('existing');
});

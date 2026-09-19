import { afterEach, expect, it } from 'vitest';
import { compile } from '@kanso/compiler';
import { browserModule } from './helpers.js';
import { installDOM } from './dom-environment.js';
installDOM();
afterEach(() => { document.body.innerHTML = ''; });

it('tracks nested patterns, rest and live context without repeating component setup', async () => {
  const app = await browserModule<{ run: (root: HTMLElement) => () => void; trace: { children: number } }>(`
    import{useState,createContext,useContext,useId}from'@kanso/core';import{mount}from'@kanso/core/client';
    export const trace={children:0};const C=createContext({user:{name:'default'},extra:'base'});
    function useDetails({user:{name},...rest}) {return {profile:{name},tuple:[name,rest.extra]}}
    function Child(){trace.children++;const {user:{name},...rest}=useContext(C);const id=useId();return <p id={id}>{name}/{rest.extra}</p>}
    function Row({user:{name},...rest}){return <span>{name}/{rest.extra}</span>}
    function App(){const[value,setValue]=useState({user:{name:'first'},extra:'one'});const {profile:{name},tuple:[,...tail]}=useDetails(value);
      return <><button onClick={()=>setValue({user:{name:'second'},extra:'two'})}>change</button><C.Provider value={value}><Child/></C.Provider><Child/><Row {...value}/><output>{name}/{tail[0]}</output></>}
    export const run=root=>mount(()=> <App/>,root);
  `);
  const dispose=app.run(document.body); const ids=[...document.querySelectorAll('p')].map(p=>p.id);
  expect(ids[0]).not.toBe(ids[1]);expect(document.querySelector('output')?.textContent).toBe('first/one');
  document.querySelector('button')!.click();
  expect([...document.querySelectorAll('p')].map(p=>p.textContent)).toEqual(['second/two','default/base']);
  expect(document.querySelector('span')?.textContent).toBe('second/two');expect(document.querySelector('output')?.textContent).toBe('second/two');
  expect(app.trace.children).toBe(2);dispose();
});

it('does not confuse unrelated names with reactive bindings or imported hooks', async () => {
  const source=`import{useState}from'@kanso/core';import{mount}from'@kanso/core/client';
    function Other(props){const label=unknown(props.value);return label}
    function helper(useState){return useState(7)}
    function App(props){const value=props.value*2;return <p>{value}/{helper(n=>n)}</p>}
    export const run=root=>mount(()=> <App value={3}/>,root);`;
  // Other is a component too, so its derived call is intentionally rejected; an ordinary function is not.
  expect(()=>compile(source)).toThrow('KANSO_PURITY');
  const app=await browserModule<{run:(root:HTMLElement)=>()=>void}>(source.replace('function Other','function other'));
  const dispose=app.run(document.body);expect(document.querySelector('p')?.textContent).toBe('6/7');dispose();
});

it('preserves primitive Context, nested providers and handler snapshots', async () => {
  const app=await browserModule<{run:(root:HTMLElement)=>()=>void; snapshots:string[]}>(`
    import{createContext,useContext,useState}from'@kanso/core';import{mount}from'@kanso/core/client';export const snapshots=[];
    const C=createContext('default');function Child(){const theme=useContext(C);return <p>{theme}</p>}
    function App(){const[theme,setTheme]=useState('light');return <><button onClick={()=>{const old=theme;setTheme('dark');snapshots.push(old)}}>change</button><C.Provider value={theme}><Child/><C.Provider value="inner"><Child/></C.Provider></C.Provider><Child/></>}
    export const run=root=>mount(()=> <App/>,root);`);
  const dispose=app.run(document.body);document.querySelector('button')!.click();
  expect([...document.querySelectorAll('p')].map(p=>p.textContent)).toEqual(['dark','inner','default']);expect(app.snapshots).toEqual(['light']);dispose();
});

it('uses one-time nested hook defaults and live array rest without widening handler snapshots', async () => {
  const app=await browserModule<{run:(root:HTMLElement)=>()=>void; trace:{defaults:number;snapshots:number[]}}>(`
    import{useState}from'@kanso/core';import{mount}from'@kanso/core/client';export const trace={defaults:0,snapshots:[]};
    function useSettings({nested:{step=(()=>{trace.defaults++;return 2})()}={}}={}){return step}
    function App(){const[options,setOptions]=useState({nested:{}});const step=useSettings(options);return <button onClick={()=>{const old=step;setOptions({nested:{step:5}});trace.snapshots.push(old)}}>{step}</button>}
    export const run=root=>mount(()=> <App/>,root);`);
  const dispose=app.run(document.body);expect(document.querySelector('button')?.textContent).toBe('2');document.querySelector('button')!.click();expect(document.querySelector('button')?.textContent).toBe('5');expect(app.trace).toEqual({defaults:1,snapshots:[2]});dispose();
  expect(()=>compile(`function useN({[getKey()]:value}){return value}`)).toThrow('KANSO_PATTERN_KEY');
  expect(()=>compile(`import{useId}from'@kanso/core';function App({show}){if(show)useId();return <p/>}`)).toThrow('KANSO_HOOK_ORDER');
});

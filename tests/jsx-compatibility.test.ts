import { afterEach, describe, expect, it } from 'vitest';
import { compile } from '@kanso/compiler';
import { browserModule } from './helpers.js';
import { installDOM } from './dom-environment.js';

installDOM();
afterEach(() => {
  document.body.innerHTML = '';
});

describe('explicit JSX migration semantics', () => {
  it('resets a keyed component, disposes effects and refs, and leaves its parent mounted', async () => {
    const app = await browserModule<{
      run(root: HTMLElement): () => void;
      trace: {
        parent: number;
        child: number;
        cleanup: number;
        refs: { current: HTMLInputElement | null }[];
      };
    }>(`
      import {useState,useEffect,useRef} from '@kanso/core';
      import {mount} from '@kanso/core/client';
      export const trace={parent:0,child:0,cleanup:0,refs:[]};
      function Child(props){
        trace.child++; const [count,setCount]=useState(0); const ref=useRef(null); trace.refs.push(ref);
        useEffect(()=>()=>{trace.cleanup++},[]);
        return <section data-key={props.key}><input ref={ref}/><button id="increment" onClick={()=>setCount(n=>n+1)}>{count}</button></section>;
      }
      function App(){
        trace.parent++; const [key,setKey]=useState(0);
        return <><button id="reset" onClick={()=>setKey(n=>n+1)}>Reset</button><Child key={key}/></>;
      }
      export const run=root=>mount(()=> <App/>,root);
    `);
    const dispose = app.run(document.body);
    const input = document.querySelector('input')!;
    document.querySelector<HTMLButtonElement>('#increment')!.click();
    expect(document.querySelector('#increment')!.textContent).toBe('1');
    document.querySelector<HTMLButtonElement>('#reset')!.click();
    expect(document.querySelector('#increment')!.textContent).toBe('0');
    expect(document.querySelector('input')).not.toBe(input);
    expect(document.querySelector('section')!.hasAttribute('data-key')).toBe(
      false,
    );
    expect(app.trace.parent).toBe(1);
    expect(app.trace.child).toBe(2);
    expect(app.trace.cleanup).toBe(1);
    expect(app.trace.refs[0].current).toBeNull();
    dispose();
    expect(app.trace.cleanup).toBe(2);
    expect(app.trace.refs[1].current).toBeNull();
  });

  it('renders, updates and clears raw HTML through explicit and spread props', async () => {
    const app = await browserModule<{ run(root: HTMLElement): () => void }>(`
      import {useState} from '@kanso/core'; import {mount} from '@kanso/core/client';
      function App(){const [html,setHtml]=useState('<b>First</b>');
        return <><button id="next" onClick={()=>setHtml('<em>Next</em>')}>Next</button>
          <button id="clear" onClick={()=>setHtml(null)}>Clear</button>
          <article dangerouslySetInnerHTML={{__html:html}}/><aside {...{dangerouslySetInnerHTML:{__html:html}}}/></>;}
      export const run=root=>mount(()=> <App/>,root);
    `);
    const dispose = app.run(document.body);
    for (const element of document.querySelectorAll('article,aside'))
      expect(element.innerHTML).toBe('<b>First</b>');
    document.querySelector<HTMLButtonElement>('#next')!.click();
    for (const element of document.querySelectorAll('article,aside'))
      expect(element.innerHTML).toBe('<em>Next</em>');
    document.querySelector<HTMLButtonElement>('#clear')!.click();
    for (const element of document.querySelectorAll('article,aside'))
      expect(element.innerHTML).toBe('');
    expect(document.querySelector('[dangerouslysetinnerhtml]')).toBeNull();
    dispose();
  });

  it('rejects conflicting content and malformed raw HTML syntax before rendering', () => {
    expect(() =>
      compile(
        'export function App(){return <div dangerouslySetInnerHTML={{__html:"hi"}}>children</div>}',
      ),
    ).toThrow('KANSO_RAW_HTML_CHILDREN');
    expect(() =>
      compile(
        'export function App(){return <div dangerouslySetInnerHTML="hi"/>}',
      ),
    ).toThrow('KANSO_RAW_HTML');
    expect(() =>
      compile(
        'export function App(){return <div dangerouslySetInnerHTML={{__html:"hi"}} children="conflict"/>}',
      ),
    ).toThrow('KANSO_RAW_HTML_CHILDREN');
    expect(() =>
      compile('export function App(){return <div {...{key:1}}/>}'),
    ).toThrow('KANSO_SPREAD_KEY');
  });

  it('diagnoses dynamic spread keys and conflicting raw content at their owner', async () => {
    const app = await browserModule<{
      run(
        root: HTMLElement,
        props: Record<string, unknown>,
        component: boolean,
      ): () => void;
    }>(`
      import {mount} from '@kanso/core/client';
      function Child(){return <div/>}
      export const run=(root,props,component)=>mount(()=>component?<Child {...props}/>:<div {...props}>children</div>,root);
    `);
    expect(() =>
      app.run(
        document.body,
        { dangerouslySetInnerHTML: { __html: 'raw' } },
        false,
      ),
    ).toThrow('KANSO_RAW_HTML_CHILDREN');
    expect(() => app.run(document.body, { key: 'id' }, false)).toThrow(
      'KANSO_SPREAD_KEY',
    );
    expect(() => app.run(document.body, { key: 'id' }, true)).toThrow(
      'KANSO_SPREAD_KEY',
    );
  });
});

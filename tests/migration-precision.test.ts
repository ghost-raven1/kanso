import { describe, expect, it } from 'vitest';
import { migrateSource } from '@kanso/cli';

const codes = (source: string) =>
  migrateSource(source, 'example.tsx').diagnostics.map(item => item.code);

describe('migration binding precision', () => {
  it('keeps opening and closing namespace component tags paired', () => {
    const result = migrateSource(
      `import React from 'react'; export function App(){return <React.Suspense fallback={<p>Wait</p>}><React.Fragment><span>Ready</span></React.Fragment></React.Suspense>}`,
      'example.tsx',
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.code).not.toContain('React.');
    expect(migrateSource(result.code, 'example.tsx').code).toBe(result.code);
  });
  it('accepts ordinary Error subclasses and inherited domain models', () => {
    expect(codes('export class ProtocolError extends Error {}')).toEqual([]);
    expect(
      codes('class Model {} export class Product extends Model {}'),
    ).toEqual([]);
  });

  it.each([
    'import {Component as Base} from "react"; export class Page extends Base {}',
    'import React from "react"; export class Page extends React.Component {}',
    'import * as React from "react"; const Base = React.PureComponent; export const Page = class extends Base {}',
    'import {Component} from "react"; class Base extends Component {} export class Page extends Base {}',
  ])('still rejects React component inheritance: %s', source => {
    expect(codes(source)).toContain('CLASS_COMPONENT');
  });

  it('does not confuse a shadowed namespace with the React import', () => {
    expect(
      codes(
        'import React from "react"; function model(React) { return class extends React.Component {}; }',
      ),
    ).not.toContain('CLASS_COMPONENT');
  });

  it('allows independent state updates and reads of unchanged state', () => {
    expect(
      codes(`import {useState} from 'react';
      export function App() {
        const [busy, setBusy] = useState(false);
        const [error, setError] = useState('');
        return <button onClick={() => { setBusy(true); setError(error); }}>{busy ? 'Busy' : error}</button>;
      }`),
    ).toEqual([]);
  });

  it.each([
    'setCount(count + 1); setCount(count + 1);',
    'setCount(1); console.log(count);',
  ])('keeps diagnostics when reads depend on a changed binding: %s', body => {
    expect(
      codes(`import {useState} from 'react'; export function App() {
      const [count,setCount] = useState(0);
      return <button onClick={() => { ${body} }}>{count}</button>;
    }`),
    ).toContain('STATE_SNAPSHOT');
  });
});

it('blocks synthetic event members but accepts native event types and shadowed ordinary objects', () => {
  const blocked = migrateSource(`import type {ChangeEvent} from 'react';export function App(){const change=(event:ChangeEvent<HTMLInputElement>)=>event.persist();return <input onChange={change}/>} `, 'App.tsx');
  expect(blocked.diagnostics.some(item=>item.code==='SYNTHETIC_EVENT')).toBe(true);
  const inline = migrateSource(`export function App(){return <input onChange={event=>event.nativeEvent}/>} `, 'App.tsx');
  expect(inline.diagnostics.some(item=>item.code==='SYNTHETIC_EVENT')).toBe(true);
  const native = migrateSource(`import type {ChangeEvent} from 'react';export function App(){const change=(event:ChangeEvent<HTMLInputElement>)=>event.currentTarget.value;const nested=(event:{persist():void})=>event.persist();return <input onChange={change}/>} `, 'App.tsx');
  expect(native.diagnostics).toEqual([]);
});

it.each([
  `import type {DragEvent} from 'react';const drag=(event:DragEvent<HTMLDivElement>)=>event.nativeEvent;`,
  `import type {WheelEventHandler as Handler} from 'react';const wheel:Handler<HTMLInputElement>=event=>event?.persist();`,
  `import type React from 'react';const click:React.MouseEventHandler<HTMLButtonElement>=event=>event.isPropagationStopped();`,
])('blocks synthetic members in native event and handler ports: %s', source => {
  expect(codes(source)).toContain('SYNTHETIC_EVENT');
  expect(codes(source)).not.toContain('UNSUPPORTED_API');
});

it('ports native handlers with aliases while preserving unrelated shadowed objects', () => {
  const source = `import type {MouseEventHandler as Handler,WheelEvent,DragEvent} from 'react';
    const click:Handler<HTMLButtonElement>=event=>{event.currentTarget.disabled=true};
    const wheel=(event:WheelEvent<HTMLInputElement>)=>event.deltaY;
    const drag=(event:DragEvent<HTMLDivElement>)=>event.dataTransfer?.getData('text/plain');
    function ordinary(){type Handler={persist():void};const event:Handler={persist(){}};event.persist()}`;
  const result = migrateSource(source, 'events.ts');
  expect(result.diagnostics).toEqual([]);
  expect(migrateSource(result.code, 'events.ts').code).toBe(result.code);
});

it.each([
  ['setUser({name:"next"}); console.log(name)', 'STATE_SNAPSHOT'],
  ['setTimeout(()=>console.log(name),0)', 'ASYNC_SNAPSHOT'],
  ['setUser({name:"next"}); console.log(label)', 'STATE_SNAPSHOT'],
])('audits nested state and derived memo snapshots: %s', (body, code) => {
  expect(codes(`import {useState,useMemo} from 'react';function App(){
    const[{name},setUser]=useState({name:'first'});const {label}=useMemo(()=>({label:name}),[name]);
    return <button onClick={()=>{${body}}}>{label}</button>}`)).toContain(code);
});

it('preserves explicit handler snapshots and independent state changes', () => {
  expect(codes(`import {useState,useMemo} from 'react';function App(){
    const[{name},setUser]=useState({name:'first'});const[enabled,setEnabled]=useState(false);
    const {label}=useMemo(()=>({label:name}),[name]);
    return <button onClick={()=>{const previous=label;setEnabled(true);console.log(label);setUser({name:'next'});setTimeout(()=>console.log(previous),0)}}>{label}/{enabled}</button>}`)).toEqual([]);
});

it('requires a destructured state tuple for migration snapshot analysis', () => {
  expect(codes(`import {useState} from 'react';function App(){const pair=useState(0);return <button onClick={()=>pair[1](1)}>{pair[0]}</button>}`)).toContain('STATE_TUPLE_PORT');
});

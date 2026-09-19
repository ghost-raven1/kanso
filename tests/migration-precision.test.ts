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

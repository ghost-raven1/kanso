/** Equivalent DOM and state transition; React code is built only in the external fixture. */
export function fixtureSource(engine) {
  const react = engine.startsWith('react');
  const solid = engine === 'solid';
  const imports = react ? `import {useState, memo} from 'react';import {createRoot} from 'react-dom/client';`
    : solid ? `import {createSignal,For} from 'solid-js';import {render} from 'solid-js/web';`
      : `import {useState} from '@kanso/core';import {mount} from '@kanso/core/client';`;
  const read = solid ? 'n()' : 'n';
  const row = solid ? 'function Row(props){return <span>{props.value * 2}</span>}'
    : 'function Row({value}){const doubled=value*2;return <span>{doubled}</span>}';
  const cell = engine === 'react-memo' ? 'MemoRow' : 'Row';
  const list = solid ? '<For each={items}>{i=><Row value={i===0?n():0}/>}</For>'
    : `{items.map(i=><${cell} key={i} value={i===0?n:0}/>)}`;
  return `${imports}
    const items=Array.from({length:500},(_,i)=>i);
    ${row}
    ${engine === 'react-memo' ? 'const MemoRow=memo(Row);' : ''}
    function App(){const[n,setN]=${solid ? 'createSignal' : 'useState'}(0);return <main><h1>Independent widgets</h1><button id="update" onClick={()=>setN(x=>x+1)}>Update one widget</button><output id="count">{${read}}</output><section>${list}</section></main>}
    ${react ? 'createRoot(document.getElementById("root")).render(<App/>);' : `${solid ? 'render' : 'mount'}(()=> <App/>,document.getElementById('root'));`}
  `;
}

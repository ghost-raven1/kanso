import { afterEach, expect, it } from 'vitest';
import { browserModule } from './helpers.js';
import { installDOM } from './dom-environment.js';
installDOM();
afterEach(()=>{document.body.innerHTML='';document.head.innerHTML='';});
it('adopts SSR tags, updates bindings and restores metadata after nested cleanup',async()=>{
  document.head.innerHTML='<title data-kanso-head="title">Count 0 · Site</title><meta name="custom" content="keep"><link data-kanso-head="stale" rel="canonical" href="https://old.test">';
  const original=document.querySelector('title');
  const app=await browserModule<{run:(root:HTMLElement)=>()=>void;setups:number}>(`
    import{useState}from'@kanso/core';import{mount}from'@kanso/core/client';import{Seo,SeoProvider,JsonLd}from'@kanso/app/seo';
    export let setups=0;
    function Detail({n}){return <><Seo title={'Count '+n}/><JsonLd id="detail" data={{'@type':'WebPage',name:'Count '+n}}/></>}
    function Page(){setups++;const[n,setN]=useState(0);const[shown,setShown]=useState(true);
      return <><button id="inc" onClick={()=>setN(x=>x+1)}>+</button><button id="toggle" onClick={()=>setShown(x=>!x)}>toggle</button>{shown&&<Detail n={n}/>}</>}
    export const run=root=>mount(()=> <SeoProvider config={{siteUrl:'https://example.com',defaultTitle:'Default',titleTemplate:'%s · Site',lang:'ru'}}><Page/></SeoProvider>,root);
  `);
  const dispose=app.run(document.body);expect(document.querySelector('title')).toBe(original);expect(document.querySelector('[data-kanso-head="stale"]')).toBeNull();
  document.querySelector<HTMLButtonElement>('#inc')!.click();expect(document.title).toBe('Count 1 · Site');expect(app.setups).toBe(1);
  expect(JSON.parse(document.querySelector('script[type="application/ld+json"]')!.textContent!).name).toBe('Count 1');
  document.querySelector<HTMLButtonElement>('#toggle')!.click();expect(document.title).toBe('Default · Site');expect(document.querySelector('script[type="application/ld+json"]')).toBeNull();
  expect(document.querySelector('meta[name="custom"]')?.getAttribute('content')).toBe('keep');dispose();expect(document.querySelector('[data-kanso-head]')).toBeNull();
});
it('diagnoses multiple metadata owners at the same level',async()=>{
  const app=await browserModule<{run:(root:HTMLElement)=>()=>void}>(`import{mount}from'@kanso/core/client';import{Seo,SeoProvider}from'@kanso/app/seo';export const run=root=>mount(()=> <SeoProvider config={{siteUrl:'https://example.com'}}><Seo title="One"/><Seo title="Two"/></SeoProvider>,root);`);
  expect(()=>app.run(document.body)).toThrow('KANSO_SEO_CONFLICT');
});

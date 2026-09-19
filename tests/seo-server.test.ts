import { expect, it, vi } from 'vitest';
import { createComponent, lazy } from 'solid-js';
import { createRequestHandler } from '@kanso/app/server';
import { useLoaderData } from '@kanso/app';
import { Seo, JsonLd, defineSeo, defineRouteSeo } from '@kanso/app/seo';

const seo=defineSeo({siteUrl:'https://example.com',lang:'ru',defaultTitle:'Default',titleTemplate:'%s · Site',image:'/share.png'});
const base={seo,buildId:'seo-test',assets:{entry:'/entry.js',styles:['/style.css'],preloads:['/chunk.js']}};
function Page(){const data=useLoaderData<{name:string}>();createComponent(Seo,{title:data.name});createComponent(JsonLd,{id:'page',data:{'@type':'WebPage',name:data.name}});return data.name;}
it('isolates asynchronous SSR requests and includes final lazy metadata in HTML and bootstrap', async()=>{
  const handler=createRequestHandler({...base,routes:[{id:'page',path:'/',component:lazy(async()=>{await new Promise(resolve=>setTimeout(resolve,5));return{default:Page}})}],context:request=>request.headers.get('X-Name'),handlers:{page:{loader:async({context})=>{await new Promise(resolve=>setTimeout(resolve,context==='A'?20:1));return{name:context}}}}});
  const html=await Promise.all(['A','B'].map(async name=>(await handler(new Request('https://example.com/',{headers:{'X-Name':name}}))).text()));
  for(const[index,name]of['A','B'].entries()){
    expect(html[index]).toContain(`<title data-kanso-head="title">${name} · Site</title>`);
    expect(html[index]).toContain('<html lang="ru">');expect(html[index]).toContain('/style.css');expect(html[index]).toContain('/chunk.js');
    expect(html[index]).toContain('application/ld+json');expect(html[index]).toContain('"seo":');
    expect(html[index]).not.toContain(`>${name==='A'?'B':'A'} · Site</title>`);
  }
});
it('resolves typed route metadata once from loader data and preserves HTTP contracts', async()=>{
  let loads=0;
  const handler=createRequestHandler({...base,routes:[{id:'page',path:'/p/:id',component:()=>'',seo:defineRouteSeo<{name:string}>(({data,params})=>({title:data.name,description:params.id}))}],handlers:{page:{loader:()=>({name:String(++loads)})}}});
  const response=await handler(new Request('https://example.com/p/one'));
  expect(await response.text()).toContain('>1 · Site</title>');expect(loads).toBe(1);
  const data=await(await handler(new Request('https://example.com/_kanso/data?url=/p/two'))).json();expect(data.seo.url).toBe('/p/two');
  const head=await handler(new Request('https://example.com/p/one',{method:'HEAD'}));expect(await head.text()).toBe('');expect(head.status).toBe(200);
  expect((await handler(new Request('https://example.com/missing'))).status).toBe(404);
});
it('serves explicit public sitemap entries and robots without invoking loaders',async()=>{
  let loads=0,enumerations=0;
  const handler=createRequestHandler({...base,routes:[{id:'public',path:'/',component:()=>'',sitemap:true},{id:'private',path:'/private',component:()=>''},{id:'hidden',path:'/hidden',component:()=>'',sitemap:true,seo:{robots:{index:false}}}],handlers:{public:{loader:()=>{loads++;return{}}}},sitemap:{entries:async()=>{enumerations++;return[{url:'/dynamic/1',lastmod:'2026-09-19'}]}},robots:{groups:[{userAgent:['*','ExampleBot'],allow:['/'],disallow:['/private']}]}});
  const maps=await Promise.all([1,2].map(async()=>await(await handler(new Request('https://example.com/sitemap.xml'))).text()));
  expect(maps[0]).toBe(maps[1]);expect(maps[0]).toContain('/dynamic/1');expect(maps[0]).not.toContain('/private');expect(maps[0]).not.toContain('/hidden');expect(loads).toBe(0);expect(enumerations).toBe(1);
  const robots=await(await handler(new Request('https://example.com/robots.txt'))).text();expect(robots).toContain('Disallow: /private');expect(robots).toContain('Sitemap: https://example.com/sitemap.xml');
  expect(await(await handler(new Request('https://example.com/sitemap.xml',{method:'HEAD'}))).text()).toBe('');
});
it('forces noindex including errors/redirects and suppresses sitemap in preview mode',async()=>{
  const handler=createRequestHandler({...base,seo:{...seo,indexable:false},routes:[{id:'page',path:'/',component:()=>{createComponent(Seo,{robots:{index:true}});return''},sitemap:true},{id:'redirect',path:'/redirect',component:()=>''}],handlers:{redirect:{loader:()=>Response.redirect('https://example.com/')}}});
  const response=await handler(new Request('https://example.com/'));expect(response.headers.get('X-Robots-Tag')).toBe('noindex');expect(await response.text()).toContain('content="noindex"');
  for(const path of ['/missing','/redirect','/sitemap.xml'])expect((await handler(new Request('https://example.com'+path))).headers.get('X-Robots-Tag')).toBe('noindex');
  expect((await handler(new Request('https://example.com/sitemap.xml'))).status).toBe(404);
  expect(await(await handler(new Request('https://example.com/robots.txt'))).text()).not.toContain('Sitemap:');
});
it('orders parent JSX below child route metadata and child JSX above its config',async()=>{
  function Layout(props:{children?:import('solid-js').JSX.Element}){createComponent(Seo,{title:'Parent',description:'Parent description'});return props.children;}
  const handler=createRequestHandler({...base,routes:[{id:'root',path:'/',component:Layout,seo:{title:'Layout config'},children:[{id:'child',path:'/child',component:()=>{createComponent(Seo,{title:'Child JSX'});return''},seo:{title:'Child config'}},{id:'sibling',path:'/sibling',component:()=>'',seo:{title:'Sibling config'}}]}]});
  const child=await(await handler(new Request('https://example.com/child'))).text();expect(child).toContain('>Child JSX · Site</title>');expect(child).toContain('content="Parent description"');
  expect(await(await handler(new Request('https://example.com/sibling'))).text()).toContain('>Sibling config · Site</title>');
});
it('keeps sitemap parts tied to their original generation across a cache refresh',async()=>{
  const now=vi.spyOn(Date,'now').mockReturnValue(0);
  try {
    let generation=0;
    const handler=createRequestHandler({...base,routes:[{id:'page',path:'/',component:()=>''}],sitemap:{ttlMs:1000,entries:async()=>{const current=++generation;return Array.from({length:50001},(_,index)=>({url:`/g${current}/${index}`}))}}});
    const index=await(await handler(new Request('https://example.com/sitemap.xml'))).text();
    expect(index).toContain('<sitemapindex');
    const first=/<loc>([^<]+)<\/loc>/.exec(index)![1];
    now.mockReturnValue(1001);
    const next=await(await handler(new Request('https://example.com/sitemap.xml'))).text();expect(next).not.toBe(index);expect(generation).toBe(2);
    const old=await(await handler(new Request(first))).text();expect(old).toContain('/g1/0');expect(old).not.toContain('/g2/');
  } finally { now.mockRestore(); }
});
it('times out a stalled sitemap provider and respects redirects from ordinary loaders',async()=>{
  let calls=0;
  const handler=createRequestHandler({...base,timeoutMs:10,routes:[{id:'page',path:'/',component:()=>''}],sitemap:{entries:()=>++calls===1?new Promise(()=>{}):[]},handlers:{page:{loader:()=>new Response(null,{status:301,headers:{Location:'/new'}})}}});
  expect((await handler(new Request('https://example.com/sitemap.xml'))).status).toBe(504);
  expect((await handler(new Request('https://example.com/sitemap.xml'))).status).toBe(200);
  expect((await handler(new Request('https://example.com/'))).status).toBe(301);
});
it('discards metadata from a failed SSR branch before rendering its error fallback',async()=>{
  const handler=createRequestHandler({...base,routes:[{id:'page',path:'/',component:()=>{createComponent(Seo,{title:'Crashed branch'});throw new Error('failure')},error:()=>{createComponent(Seo,{title:'Fallback',robots:{index:false}});return'Fallback'}}]});
  const response=await handler(new Request('https://example.com/'));
  const html=await response.text();expect(response.status).toBe(200);expect(html).toContain('>Fallback · Site</title>');expect(html).not.toContain('>Crashed branch · Site</title>');expect(response.headers.get('X-Robots-Tag')).toBe('noindex');
});

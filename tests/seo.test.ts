import { expect, it } from 'vitest';
import { defineSeo, defineRouteSeo, productJsonLd, breadcrumbJsonLd } from '@kanso/app/seo';
import { mergeSeo, resolveSeo, renderHead } from '../packages/app/src/seo/resolve.js';
import { buildSitemapParts } from '../packages/app/src/seo/sitemap.js';
import { inspectSeoHtml, checkSeo } from '@kanso/cli';

const config = defineSeo({ siteUrl: 'https://example.com', defaultTitle: 'Home', titleTemplate: '%s · Site', description: 'Default', lang: 'ru', image: '/image.png' });
const tag = (snapshot: ReturnType<typeof resolveSeo>, key: string) => snapshot.tags.find(tag => tag.key === key);
it('merges fields, clears nulls, replaces arrays and applies the nearest title template once', () => {
  const merged = mergeSeo(config, { title: 'Page', description: null, openGraph: { images: ['/a.png','/b.png'] } });
  const head = resolveSeo(config, merged, '/Page/?page=2&utm_source=x&gclid=y#top');
  expect(tag(head,'title')?.text).toBe('Page · Site');
  expect(tag(head,'description')).toBeUndefined();
  expect(tag(head,'canonical')?.attrs.href).toBe('https://example.com/Page/?page=2');
  expect(tag(head,'og:title')?.attrs.content).toBe('Page · Site');
  expect(head.tags.filter(tag=>tag.attrs.property==='og:image')).toHaveLength(2);
  expect(tag(resolveSeo(config,mergeSeo(merged,{title:{absolute:'Only this'},openGraph:null,twitter:null,canonical:null}),'/'),'title')?.text).toBe('Only this');
  expect(resolveSeo(config,mergeSeo(merged,{openGraph:null,twitter:null,canonical:null}),'/').tags.some(tag=>tag.key==='canonical'||tag.key.startsWith('og:'))).toBe(false);
  expect(mergeSeo({openGraph:{images:['a'],title:'old'}},{openGraph:{images:['b'],title:undefined}}).openGraph).toEqual({images:['b'],title:'old'});
});
it('uses explicit social overrides, forced noindex, language alternatives and image attributes', () => {
  const head=resolveSeo({...config,indexable:false},mergeSeo(config,{robots:{index:true,follow:true},dir:'rtl',openGraph:{title:'Share',images:[{url:'/a.jpg',alt:'Photo',width:1200,height:630}]},alternates:{ru:'/ru',en:'/en','x-default':'/'}}),'/');
  expect(tag(head,'robots')?.attrs.content).toBe('noindex, follow');expect(head.noindex).toBe(true);
  expect(tag(head,'og:title')?.attrs.content).toBe('Share');expect(tag(head,'og:image:0:width')?.attrs.content).toBe('1200');
  expect(tag(head,'alternate:en')?.attrs.href).toBe('https://example.com/en');expect(head.dir).toBe('rtl');
  expect(()=>defineSeo({siteUrl:'javascript:alert(1)'})).toThrow('KANSO_SEO_URL');
  expect(()=>resolveSeo(config,{image:{url:'/x',width:-1}},'/')).toThrow('KANSO_SEO_IMAGE');
});
it('serializes hostile text and JSON-LD without manufacturing facts', () => {
  const product=productJsonLd({name:'</script><script>bad()</script>',url:'https://example.com/p'});
  const html=renderHead(resolveSeo(config,{title:'<img src=x>',jsonLd:{product}},'/'));
  expect(html).toContain('&lt;img src=x&gt;');expect(html).not.toContain('<script>bad()');expect(html).toContain('\\u003c/script>');
  expect(product).not.toHaveProperty('offers');expect(product).not.toHaveProperty('aggregateRating');
  expect(breadcrumbJsonLd([{name:'Home',url:'https://example.com'}]).itemListElement).toEqual([{'@type':'ListItem',position:1,name:'Home',item:'https://example.com'}]);
  expect(defineRouteSeo<{name:string}>(({data})=>({title:data.name}))({data:{name:'Typed'},params:{},url:new URL('https://example.com')})).toEqual({title:'Typed'});
});
it('splits sitemap by count and encoded bytes, deduplicates canonical URLs and escapes XML', async () => {
  const entries=[{url:'/a?x=1&y=2',lastmod:'2026-09-19',alternates:{en:'/en'}},{url:'/b'},{url:'/b?utm_source=test'},{url:'/c'}];
  const signal=new AbortController().signal;
  const parts=await buildSitemapParts(entries,config.siteUrl,signal,{urls:2,bytes:10000});
  expect(parts).toHaveLength(2);expect(parts[0]).toContain('x=1&amp;y=2');expect(parts[0]).toContain('xhtml:link');
  const limited=await buildSitemapParts([{url:'/one'},{url:'/two'}],config.siteUrl,signal,{urls:50000,bytes:230});
  expect(limited).toHaveLength(2);
  await expect(buildSitemapParts([{url:'https://other.test/'}],config.siteUrl,signal)).rejects.toThrow('KANSO_SITEMAP_ORIGIN');
});
it('reports invalid source metadata while incomplete content is only a warning', () => {
  const invalid=inspectSeoHtml('<head><title>A</title><title>B</title><link rel="canonical" href="/relative"><meta name="robots" content="noindex"><script type="application/ld+json">no JSON</script></head>',config.siteUrl);
  expect(invalid.noindex).toBe(true);expect(invalid.diagnostics.map(item=>item.code)).toEqual(expect.arrayContaining(['SEO_DUPLICATE','SEO_URL','SEO_JSON_LD']));
  expect(inspectSeoHtml('<head><title>Minimal</title></head>',config.siteUrl).diagnostics.every(item=>item.severity==='warning')).toBe(true);
});
it('audits sitemap status, noindex and truncation without requesting other origins', async () => {
  const calls:string[]=[];
  const fetcher=(async(input)=>{
    const url=String(input);calls.push(url);const path=new URL(url).pathname;
    if(path==='/robots.txt')return new Response('User-agent: *\nSitemap: https://other.test/sitemap.xml');
    if(path==='/sitemap.xml')return new Response('<urlset><url><loc>https://example.com/hidden</loc></url><url><loc>https://example.com/redirect</loc></url><url><loc>https://example.com/more</loc></url></urlset>');
    if(path==='/redirect')return new Response(null,{status:302,headers:{Location:'/next'}});
    return new Response(`<head><title>Same</title>${path==='/hidden'?'<meta name="robots" content="noindex">':''}</head>`,{headers:{'Content-Type':'text/html'}});
  }) as typeof fetch;
  const result=await checkSeo({url:config.siteUrl,maxPages:3,fetcher});
  expect(result.pages).toBe(3);expect(result.truncated).toBe(true);
  expect(result.diagnostics.map(item=>item.code)).toEqual(expect.arrayContaining(['SEO_SITEMAP_NOINDEX','SEO_PAGE_STATUS','SEO_TRUNCATED','SEO_REPEATED_TITLE']));
  expect(calls.every(url=>url.startsWith('https://example.com'))).toBe(true);
});

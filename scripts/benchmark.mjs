import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { cpus, platform, release } from 'node:os';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { transformSync } from '@babel/core';
import solidPreset from 'babel-preset-solid';
import { compile } from '@kanso/compiler';
import { chromium } from 'playwright';
import { fixtureSource } from './bench-fixtures.mjs';

const output = resolve('output/benchmark');
const external = resolve(output, 'external-react');
await mkdir(external, { recursive: true });
await writeFile(resolve(external, 'package.json'), JSON.stringify({ name: 'kanso-external-reference', private: true, type: 'module', dependencies: { react: '19.3.0', 'react-dom': '19.3.0', 'babel-plugin-react-compiler': '1.0.0' } }, null, 2));
// Its own manifest, lock and node_modules: no React enters Kanso's workspace graph.
execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--workspaces=false'], { cwd: external, stdio: 'inherit' });
const externalRequire = createRequire(resolve(external, 'package.json'));
const compiler = externalRequire('babel-plugin-react-compiler');
const names = ['kanso', 'solid', 'react', 'react-memo', 'react-compiler'];
const files = new Map();
const sizes = {};
for (const name of names) {
  let source = fixtureSource(name);
  await writeFile(resolve(output, `${name}.input.jsx`), source);
  if (name === 'kanso') source = compile(source, { filename: 'benchmark.tsx', sourceMaps: false }).code;
  if (name === 'solid') source = transformSync(source, { filename: 'benchmark.jsx', configFile: false, babelrc: false, presets: [[solidPreset, { generate: 'dom', hydratable: true }]] }).code;
  if (name === 'react-compiler') source = transformSync(source, { filename: 'benchmark.jsx', configFile: false, babelrc: false, parserOpts: { plugins: ['jsx'] }, plugins: [[compiler, { target: '19' }]] }).code;
  await writeFile(resolve(output, `${name}.compiled.jsx`), source);
  const bundle = await build({ stdin: { contents: source, resolveDir: name.startsWith('react') ? external : process.cwd(), loader: 'jsx' },
    bundle: true, write: false, format: 'esm', platform: 'browser', minify: true,
    jsx: 'automatic', jsxImportSource: 'react', conditions: ['browser'], define: { 'process.env.NODE_ENV': '"production"' } });
  const js = bundle.outputFiles[0].text;
  files.set(`/${name}.js`, js);
  sizes[name] = { raw: Buffer.byteLength(js), gzip: gzipSync(js).length };
  await writeFile(resolve(output, `${name}.js`), js);
}
const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (files.has(request.url)) { response.setHeader('Content-Type', 'text/javascript'); response.end(files.get(request.url)); return; }
  const name = request.url.slice(1);
  if (!names.includes(name)) { response.writeHead(404).end(); return; }
  response.setHeader('Content-Type', 'text/html');
  response.end(`<!doctype html><html><head><meta charset="utf-8"><style>body{font:16px system-ui}section{display:grid;grid-template-columns:repeat(20,1fr)}span{padding:4px}</style></head><body><div id="root"></div><script>window.paintMetrics={lcp:0};new PerformanceObserver(l=>{for(const e of l.getEntries())window.paintMetrics.lcp=e.startTime}).observe({type:'largest-contentful-paint',buffered:true});</script><script type="module" src="/${name}.js"></script></body></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const browser = await chromium.launch();
const rows = [];
const median = values => [...values].sort((a,b)=>a-b)[Math.floor(values.length / 2)];
try {
  for (const name of names) {
    const samples = [];
    for (let iteration = 0; iteration < 5; iteration++) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const session = await context.newCDPSession(page);
      await session.send('Performance.enable');
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${port}/${name}`);
      await page.locator('section span').nth(499).waitFor();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const load = await page.evaluate(() => ({ dcl: performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd,
        fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null, lcp: window.paintMetrics.lcp }));
      const before = (await session.send('Performance.getMetrics')).metrics;
      const interactions = await page.evaluate(async () => {
        const times = [];
        const count = document.querySelector('#count');
        for (let i=1;i<=100;i++) {
          const start=performance.now();
          const complete = new Promise(resolve => {
            const observer=new MutationObserver(()=>{if(count.textContent===String(i)){observer.disconnect();resolve()}});
            observer.observe(count,{subtree:true,childList:true,characterData:true});
          });
          document.querySelector('#update').click();
          await complete;
          times.push(performance.now()-start);
        }
        return times;
      });
      const after = (await session.send('Performance.getMetrics')).metrics;
      const metric = (values, key) => values.find(value => value.name === key).value;
      assert.equal(await page.locator('section span').first().textContent(), '200');
      assert.equal(await page.locator('section span').nth(499).textContent(), '0');
      assert.deepEqual(errors, []);
      samples.push({ ...load, updateMedian: median(interactions), updateP95: [...interactions].sort((a,b)=>a-b)[95],
        scriptMs: (metric(after,'ScriptDuration')-metric(before,'ScriptDuration'))*1000,
        taskMs: (metric(after,'TaskDuration')-metric(before,'TaskDuration'))*1000 });
      await context.close();
    }
    rows.push({ engine: name, jsBytes: sizes[name], median: Object.fromEntries(Object.keys(samples[0]).map(key => [key, median(samples.map(s=>s[key]))])), samples });
    console.log(name, JSON.stringify(rows.at(-1).median));
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
const report = { recordedAt: new Date().toISOString(), environment: { platform: platform(), release: release(), cpu: cpus()[0].model, node: process.version, chromium: browser.version() },
  versions: { solid: JSON.parse(await readFile('node_modules/solid-js/package.json','utf8')).version, react: externalRequire('react/package.json').version, reactCompiler: externalRequire('babel-plugin-react-compiler/package.json').version },
  method: 'Production minified bundles; 500 widgets; one parent state changes one row. Five fresh browser contexts, 100 click-to-DOM updates each. CPU is CDP ScriptDuration/TaskDuration delta. Local unthrottled HTTP; paint metrics are lab observations, not field INP/Lighthouse or a general speedup claim.', rows };
await writeFile(resolve(output,'results.json'), JSON.stringify(report,null,2));
console.log(`Report: ${resolve(output,'results.json')}`);

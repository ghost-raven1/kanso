import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const port = process.env.KANSO_SEO_PORT ?? '4173';
const previewOrigin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['examples/lab/serve.mjs'], { env: { ...process.env, PORT: port }, stdio: ['ignore', 'pipe', 'pipe'] });
let logs=''; server.stderr.on('data', chunk=>{logs+=chunk;});
const fixture=createServer((request,response)=>{
  if(request.url==='/robots.txt'||request.url==='/sitemap.xml'){response.writeHead(404).end();return;}
  response.setHeader('Content-Type','text/html');
  response.end(request.url==='/invalid' ? '<head><title>A</title><title>B</title><script type="application/ld+json">broken</script></head>' : '<head><title>Warnings only</title></head>');
});
const command=(args)=>new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['packages/cli/dist/bin.js','seo','check',...args],{stdio:['ignore','pipe','pipe']});
  let output='',errors='';child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{errors+=chunk;});
  child.on('error',reject);child.on('exit',code=>resolve({code,output,errors}));
});
try{
  for(let i=0;;i++){
    if(server.exitCode!==null)throw new Error(`SEO preview failed: ${logs}`);
    try{if((await fetch(`${previewOrigin}/healthz`)).ok)break;}catch{}
    if(i>100)throw new Error(`SEO preview timed out: ${logs}`);
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  const production=await command(['--url',previewOrigin,'--json']);
  assert.equal(production.code,0,production.output+production.errors);
  const report=JSON.parse(production.output);assert.equal(report.truncated,false);assert.equal(report.pages,5);assert.deepEqual(report.diagnostics,[]);
  await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${fixture.address().port}`;
  const invalid=await command(['--url',origin+'/invalid','--json']);assert.equal(invalid.code,2);assert(JSON.parse(invalid.output).diagnostics.some(item=>item.code==='SEO_JSON_LD'));
  const warning=await command(['--url',origin,'--json']);assert.equal(warning.code,0);assert(JSON.parse(warning.output).diagnostics.every(item=>item.severity==='warning'));
  assert.equal((await command(['--url','bad-url','--json'])).code,1);
  await mkdir('output/seo',{recursive:true});await writeFile('output/seo/results.json',JSON.stringify({production:report,invalidExitCode:invalid.code,warningExitCode:warning.code},null,2));
  console.log('SEO passed: production source HTML + sitemap; invalid metadata exits 2, warnings exit 0.');
}finally{server.kill('SIGTERM');await new Promise(resolve=>fixture.close(resolve));}

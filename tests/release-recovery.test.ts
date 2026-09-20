import { expect, it, vi } from 'vitest';
import { createRequestHandler } from '@kanso/app/server';
import { createNavigationLoader } from '@kanso/app';
import { responseError, requiresReload } from '../packages/app/src/recovery.js';

it.each(['GET','HEAD','POST','native POST'])('rejects an old document before running handlers: %s', async method => {
  const loader=vi.fn(()=>({name:'new'})); const action=vi.fn(()=>({data:'saved'}));
  const handler=createRequestHandler({buildId:'new',assets:{entry:'/client.js'},routes:[{id:'home',path:'/',component:()=> 'Home'}],handlers:{home:{loader,action}}});
  const native=method==='native POST'; const post=method==='POST'||native;
  const body=new FormData();body.set('__kanso_build','old');body.set('__kanso_route','home');
  const response=await handler(new Request('https://host.test'+(native?'/':post?'/_kanso/action/home':'/_kanso/data?url=%2F'),{
    method:post?'POST':method,...(post?{body}:{}),headers:native?{}:{'X-Kanso-Build':'old'},
  }));
  expect(response.status).toBe(409);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(response.headers.get('X-Kanso-Recovery')).toBe('reload');
  expect(requiresReload(responseError(response,'Submit failed'))).toBe(true);
  expect(loader).not.toHaveBeenCalled();expect(action).not.toHaveBeenCalled();
  if(method==='HEAD') expect(await response.text()).toBe('');
});

it('retains recovery metadata through the data transport without replaying requests', async () => {
  const fetcher=vi.fn(async()=>new Response('old',{status:503,headers:{'X-Kanso-Error':'MF_RUNTIME_MISMATCH','X-Kanso-Recovery':'reload'}}));
  const navigation=createNavigationLoader(fetcher,undefined,'old');
  await expect(navigation.load('/')).rejects.toMatchObject({reload:true,code:'MF_RUNTIME_MISMATCH',status:503});
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]).toBeDefined();
});

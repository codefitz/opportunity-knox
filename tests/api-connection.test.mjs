import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8');
const javascript = ts.transpileModule(source, { compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext} }).outputText;
const {api, ApiError, isTemporaryConnectionError} = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);

test('restart can distinguish transport/gateway interruptions from real errors and cancellation', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(api('/board'), error => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 0);
    assert.equal(error.message, 'Failed to fetch');
    assert.equal(isTemporaryConnectionError(error), true);
    return true;
  });
  for (const status of [400, 401, 403, 409, 500, 502, 503, 504]) {
    globalThis.fetch = async () => new Response(JSON.stringify({error:'Specific server error'}), {status});
    await assert.rejects(api('/board'), error => {
      assert.equal(error.status, status);
      assert.equal(error.message, 'Specific server error');
      assert.equal(isTemporaryConnectionError(error), [502,503,504].includes(status));
      return true;
    });
  }
  assert.equal(isTemporaryConnectionError(new TypeError('Programming error')), false);
  const aborted = new DOMException('Cancelled', 'AbortError');
  globalThis.fetch = async () => { throw aborted; };
  await assert.rejects(api('/board'), error => error === aborted);
});

test('API requests carry the workspace identity and stale tabs reload after a reset',async t=>{
 const originalFetch=globalThis.fetch,originalWindow=globalThis.window;
 t.after(()=>{globalThis.fetch=originalFetch;if(originalWindow===undefined)delete globalThis.window;else globalThis.window=originalWindow;});
 globalThis.fetch=async()=>Response.json({ok:true},{headers:{'X-Board-Workspace':'before-reset'}});
 await api('/board');
 let sent;globalThis.fetch=async(_url,options)=>{sent=options.headers['X-Board-Workspace'];return Response.json({ok:true},{headers:{'X-Board-Workspace':'after-reset'}});};
 await api('/workspace-actions/apply',{method:'POST'});assert.equal(sent,'before-reset');
 let reloaded=false;globalThis.window={location:{reload(){reloaded=true;}}};
 globalThis.fetch=async(_url,options)=>{sent=options.headers['X-Board-Workspace'];return Response.json({error:'Workspace changed'},{status:409,headers:{'X-Board-Workspace':'another-reset'}});};
 await assert.rejects(api('/workspace-actions/apply',{method:'POST'}),error=>error instanceof ApiError&&error.status===409);
 reloaded=false;await assert.rejects(api('/board'),error=>error instanceof ApiError&&error.status===409);
 assert.equal(sent,'after-reset');assert.equal(reloaded,true);
});

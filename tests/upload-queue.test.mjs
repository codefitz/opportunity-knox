import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {uploadQueue,queueStore} from '../src/lib/upload-queue.ts';
const options={kind:'reference',status:'draft',notes:'Fictional evidence',category:'other',batchUploads:true};
const item=(path='fictional.txt')=>({path,file:new File(['Fictional saved bytes'],path,{type:'text/plain'})});
test('queued file bytes, paths and preferences survive reopening the database and deduplicate paths',async()=>{
 const scope='fictional-library';await uploadQueue.add(scope,[item('folder/fictional.txt'),item('folder/fictional.txt')]);await uploadQueue.options(scope,options);
 const a=await uploadQueue.load(scope),b=await uploadQueue.load(scope);assert.equal(a.files.length,1);assert.equal(b.files[0].id,a.files[0].id);assert.equal(b.files[0].path,'folder/fictional.txt');assert.equal(await b.files[0].file.text(),'Fictional saved bytes');assert.deepEqual(b.options,options);assert.equal((await uploadQueue.load('other-workspace')).files.length,0);
});
test('attempt options and retry identifiers persist, and competing owners cannot acquire or remove a live queue',async()=>{
 const scope='fictional-attempt';await uploadQueue.add(scope,[item()]);const file=(await uploadQueue.load(scope)).files[0];await uploadQueue.lease(scope,'tab-one');const a=await uploadQueue.attempt(scope,file.id,'tab-one',options);
 await assert.rejects(uploadQueue.lease(scope,'tab-two'));await assert.rejects(uploadQueue.remove(scope,null));
 await uploadQueue.failed(scope,file.id,'Fictional connection interrupted');await uploadQueue.lease(scope,'tab-one',true);await uploadQueue.lease(scope,'tab-two');const b=await uploadQueue.attempt(scope,file.id,'tab-two',{...options,status:'approved'});assert.deepEqual(b.attempt,a.attempt);assert.equal(b.id,a.id);assert.match(b.error,/interrupted/);await uploadQueue.remove(scope,[file.id],'tab-two');assert.equal((await uploadQueue.load(scope)).files.length,0);await uploadQueue.lease(scope,'tab-two',true);
});
test('aborted queue transaction leaves original bytes recoverable; oversized batches do not partially enqueue',async()=>{
 const scope='fictional-abort';await uploadQueue.add(scope,[item()]);await assert.rejects(queueStore(scope,true,(files)=>{files.clear();files.transaction.abort();}));assert.equal((await uploadQueue.load(scope)).files.length,1);
 const large={path:'oversized.txt',file:new File([new Uint8Array(15*1024*1024+1)],'oversized.txt')};await assert.rejects(uploadQueue.add(scope,[item('small.txt'),large]),/15 MB/);assert.equal((await uploadQueue.load(scope)).files.length,1);
});
test('recovered queues try unattempted files before earlier failures',async()=>{
 const scope='fictional-batches';await uploadQueue.add(scope,[item('first.txt'),item('second.txt')]);const first=(await uploadQueue.load(scope)).files[0];await uploadQueue.failed(scope,first.id,'Fictional failure');assert.equal((await uploadQueue.load(scope)).files.at(-1).id,first.id);await uploadQueue.add(scope,[item('third.txt')]);assert.deepEqual((await uploadQueue.load(scope)).files.map(v=>v.path),['second.txt','third.txt','first.txt']);
});

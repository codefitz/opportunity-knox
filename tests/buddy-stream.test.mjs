import test from 'node:test';
import assert from 'node:assert/strict';
import {callProvider,providerRequest,defaultBuddy,updateBuddy} from '../server/buddy-provider.mjs';
import {partialStringProperty,replyPreview,readProviderStream} from '../server/buddy-stream.mjs';
const enc=new TextEncoder();
function streamResponse(wire,type='text/event-stream',stride=7){const bytes=enc.encode(wire);return new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=stride)c.enqueue(bytes.slice(i,i+stride));c.close();}}),{headers:{'content-type':type}});}
const data=v=>'data: '+JSON.stringify(v)+'\r\n\r\n';
const payload=JSON.stringify({reply:'Fictional café ☕ encouragement.',changes:[],draft:{kind:'none',title:'',content:''},sourceIds:[]});
function wire(provider,output=payload){
 const pieces=[output.slice(0,17),output.slice(17)];
 if(provider==='ollama')return pieces.map(content=>JSON.stringify({message:{content}})+'\n').join('')+JSON.stringify({done:true,done_reason:'stop',load_duration:2500000000,prompt_eval_duration:100000000,eval_duration:500000000})+'\n';
 if(provider==='openai')return pieces.map(delta=>data({type:'response.output_text.delta',delta})).join('')+data({type:'response.completed',response:{status:'completed'}});
 if(provider==='anthropic')return data({type:'ping'})+pieces.map(text=>data({type:'content_block_delta',delta:{type:'text_delta',text}})).join('')+data({type:'message_delta',delta:{stop_reason:'end_turn'}})+data({type:'message_stop'});
 if(provider==='gemini')return pieces.map(text=>data({candidates:[{content:{parts:[{thought:true,text:'DO NOT DISPLAY THOUGHT'},{text}]}}]})).join('')+data({candidates:[{finishReason:'STOP'}]});
 return pieces.map(content=>data({choices:[{index:0,delta:{content}}]})).join('')+data({choices:[{index:0,delta:{},finish_reason:'stop'}]})+'data: [DONE]\n\n';
}
test('each HTTP adapter requests streaming only for interactive previews, with explicit opt-out',()=>{
 for(const provider of ['openai','anthropic','gemini','ollama','custom']){
  const c={provider,model:'fictional',apiKey:'private-fixture',baseUrl:'https://fictional.example/v1',outputMode:'schema'};
  assert.equal(providerRequest(c,'',[]).streaming,false);
  const r=providerRequest({...c,onDelta(){}},'',[]);assert.equal(r.streaming,true);
  assert.equal(provider==='gemini'?r.url.endsWith(':streamGenerateContent?alt=sse'):r.body.stream===true,true);
  assert.equal(providerRequest({...c,onDelta(){},streamResponses:false},'',[]).streaming,false);
 }
 assert.throws(()=>updateBuddy(defaultBuddy(),{revision:1,streamResponses:'yes'}),{status:400});
});
test('all five stream formats survive fragmented UTF-8/framing and report actual output without thoughts',async()=>{
 for(const provider of ['openai','anthropic','gemini','ollama','custom']){
  const previews=[],diagnostics=[];const result=await callProvider({provider,model:'fictional',apiKey:'fixture',baseUrl:'https://fictional.example/v1',onDelta:t=>previews.push(t),onDiagnostics:d=>diagnostics.push(d)},'',[],async()=>streamResponse(wire(provider),provider==='ollama'?'application/x-ndjson':'text/event-stream',1));
  assert.equal(result,payload);assert.equal(previews.at(-1),payload);assert.ok(diagnostics.some(d=>d.firstResponseMs>=0));assert.ok(diagnostics.some(d=>d.providerMs>=0));
  if(provider==='ollama')assert.ok(diagnostics.some(d=>d.modelLoadMs===2500&&d.promptEvaluationMs===100&&d.generationMs===500));
 }
});
test('premature EOF, malformed frames, provider errors and all incomplete finish reasons reject the whole answer',async()=>{
 const cases=[['custom',data({choices:[{delta:{content:payload},finish_reason:'length'}]})],['openai',data({type:'response.output_text.delta',delta:payload})],['openai',data({type:'response.incomplete'})],['anthropic',data({type:'message_delta',delta:{stop_reason:'max_tokens'}})+data({type:'message_stop'})],['gemini',data({candidates:[{finishReason:'SAFETY'}]})],['ollama',JSON.stringify({done:true,done_reason:'length'})+'\n'],['custom','data: {broken}\n\n'],['custom',data({error:{message:'DO NOT LEAK PRIVATE BODY'}})]];
 for(const [provider,body] of cases)await assert.rejects(readProviderStream(streamResponse(body,provider==='ollama'?'application/x-ndjson':'text/event-stream'),{provider},new AbortController().signal),e=>e.status===502&&!e.message.includes('DO NOT LEAK'));
});
test('stream byte limits and stalled-body cancellation are enforced even when a fetcher ignores the signal',async()=>{
 await assert.rejects(readProviderStream(streamResponse('x'.repeat(8*1024*1024+1),'text/event-stream',65536),{provider:'custom'},new AbortController().signal),{status:502});
 const controller=new AbortController();let entered;const started=new Promise(r=>entered=r);let closed=false;
 const pending=callProvider({provider:'custom',baseUrl:'https://fictional.example',model:'f',signal:controller.signal,onDelta(){}},'',[],async()=>new Response(new ReadableStream({start(){entered();},cancel(){closed=true;}}),{headers:{'content-type':'text/event-stream'}}));await started;controller.abort();await assert.rejects(pending,{status:499});assert.equal(closed,true);
});
test('a server returning ordinary JSON remains compatible without silently retrying generation',async()=>{
 let calls=0;const stats=[];const out=await callProvider({provider:'custom',model:'f',baseUrl:'https://fictional.example',onDelta(){},onDiagnostics:d=>stats.push(d)},'',[],async()=>{calls++;return Response.json({choices:[{finish_reason:'stop',message:{content:payload}}]});});assert.equal(out,payload);assert.equal(calls,1);assert.ok(stats.some(d=>d.responseMode==='buffered'));
});
test('preview decoding is restricted to the actual top-level reply, handles nested JSON and incomplete escapes',()=>{
 assert.equal(partialStringProperty('{"changes":[{"reply":"wrong"}],"reply":"A\\nB\\u00','reply'),'A\nB');
 assert.equal(replyPreview('{"reply":"Hello \\ud83d'),'Hello ');
 const outer=JSON.stringify({reply:JSON.stringify({intent:'coach',message:'Use your café work. ☕',tasks:[]}),draft:{content:'HIDDEN DRAFT'},changes:[]});
 for(let end=0;end<=outer.length;end++)assert.ok(!replyPreview(outer.slice(0,end),true).includes('HIDDEN DRAFT'));
 assert.equal(replyPreview(outer,true),'Use your café work. ☕');
 assert.equal(replyPreview('{"draft":{"reply":"wrong"}}'),'');
});

test('stream rejection gives the explicit opt-out without automatically repeating a chargeable request',async()=>{
 let calls=0;
 await assert.rejects(callProvider({provider:'custom',model:'f',baseUrl:'https://fictional.example',onDelta(){}},'',[],async()=>{calls++;return new Response('PRIVATE PROVIDER ERROR',{status:400});}),e=>e.status===502&&e.message.includes('turn off live answer previews')&&!e.message.includes('PRIVATE'));
 assert.equal(calls,1);
});

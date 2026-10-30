import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createBuddyRequests } from "../server/buddy-requests.mjs";
test("restart marks unfinished requests and preserved user messages interrupted without retrying", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(
      "CREATE TABLE standalone_messages(id TEXT PRIMARY KEY,data TEXT NOT NULL)",
    );
    const controls = createBuddyRequests(db);
    controls.start("fictional-request", "fictional-chat", {
      provider: "custom",
      model: "fictional",
    });
    db.prepare("INSERT INTO standalone_messages VALUES (?,?)").run(
      "u",
      JSON.stringify({
        role: "user",
        requestId: "fictional-request",
        status: "pending",
        content: "Fictional preserved draft",
      }),
    );
    createBuddyRequests(db);
    const request = JSON.parse(
      db.prepare("SELECT data FROM buddy_requests").get().data,
    );
    assert.equal(request.stage, "interrupted");
    const message = JSON.parse(
      db.prepare("SELECT data FROM standalone_messages").get().data,
    );
    assert.equal(message.status, "interrupted");
    assert.equal(message.content, "Fictional preserved draft");
  } finally {
    db.close();
  }
});

test('live previews never enter SQLite diagnostics; cancellation clears previews and retains only safe timings',async()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE standalone_messages(id TEXT PRIMARY KEY,data TEXT NOT NULL)');
 try{
  const requests=createBuddyRequests(db);const task=requests.start('preview','chat',{provider:'custom',model:'f',previewFormat:'standalone'});
  task.progress('waiting-provider');task.preview(JSON.stringify({reply:JSON.stringify({message:'FICTIONAL PRIVATE LIVE TEXT'})}));assert.equal(requests.read('preview').preview,'FICTIONAL PRIVATE LIVE TEXT');
  task.diagnostics({modelLoadMs:2500,unknown:'PRIVATE SECRET',generationMs:-1,responseMode:'streamed'});
  assert.equal(db.prepare('SELECT data FROM buddy_requests').get().data.includes('PRIVATE'),false);
  await requests.handle('/api/buddy/requests/preview','POST',null,null,{readBody:async()=>({cancel:true}),json(){}});
  task.preview(JSON.stringify({reply:'LATE PREVIEW'}));assert.equal(requests.read('preview').preview,undefined);assert.equal(requests.read('preview').cancellation,'unconfirmed');
  task.diagnostics({cancellation:'transport-stopped'});task.finish('cancelled');
  const r=requests.read('preview');assert.equal(r.cancellation,'transport-stopped');assert.ok(r.cancelRequestedAt);assert.equal(r.timings.modelLoadMs,2500);assert.equal(r.timings.generationMs,undefined);assert.equal(r.timings.unknown,undefined);assert.equal(r.preview,undefined);
 }finally{db.close();}
});

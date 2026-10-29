import test from 'node:test';import assert from 'node:assert/strict';import {createBackupSchedule} from '../server/backup-schedule.mjs';
test('daily backup schedule survives restart, catches up once, retains failure diagnostics and backs off',async()=>{
 const config=new Map();let clock=Date.parse('2026-10-29T10:00:00Z'),calls=0,fail=false;const ctx={getConfig:k=>config.get(k),putConfig:(k,v)=>config.set(k,v),clock:()=>clock,timers:false,createBackup:()=>{calls++;if(fail)throw Error('Fictional disk failure');return {name:'board-fictional-'+calls};}};
 let scheduler=createBackupSchedule(ctx);let response;const invoke=(path,method,body)=>scheduler.handle(path,method,null,null,{readBody:async()=>body,json:(_,v)=>{response=v;}});
 await invoke('/api/backups/schedule','GET');assert.equal(response.enabled,false);await invoke('/api/backups/schedule','PATCH',{revision:1,enabled:true,intervalHours:24});assert.equal(calls,0);clock+=25*3600000;scheduler.close();scheduler=createBackupSchedule(ctx);scheduler.tick();assert.equal(calls,1);scheduler.tick();assert.equal(calls,1);assert.match(config.get('backupSchedule').lastBackup,/fictional/);
 clock+=25*3600000;fail=true;scheduler.tick();assert.equal(calls,2);assert.match(config.get('backupSchedule').lastError,/could not complete/);scheduler.tick();assert.equal(calls,2);clock+=3600001;fail=false;scheduler.tick();assert.equal(calls,3);assert.equal(config.get('backupSchedule').lastError,'');scheduler.close();
});
test('scheduled work waits until workspace activation has committed',async()=>{
 let config,allowed=false,calls=0,clock=Date.parse('2026-10-29T10:00:00Z');const schedule=createBackupSchedule({getConfig:()=>config,putConfig:(_,v)=>{config=v;},clock:()=>clock,timers:false,canRun:()=>allowed,createBackup:()=>{calls++;return {name:'board-fictional'};}});
 await schedule.handle('/api/backups/schedule','PATCH',null,null,{readBody:async()=>({revision:1,enabled:true,intervalHours:24}),json:()=>{}});clock+=25*3600000;schedule.tick();assert.equal(calls,0);allowed=true;schedule.tick();assert.equal(calls,1);schedule.close();
});

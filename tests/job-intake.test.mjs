import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync,readdirSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {makePassages,validateIntakeReply,createJobIntake} from '../server/job-intake.mjs';
import {readJobPDF} from '../server/job-intake-pdf.mjs';
const pages=[{page:1,method:'ocr',text:'Fictional Atlas Ltd\nSenior Platform Architect\nSalary GBP 90,000 per year.\nClosing date 31 December 2026.\nContact Pat Example at pat@example.test.'}];
test('intake evidence rejects invented values/quotes, unsupported fields, duplicate suggestions and missing-year dates',()=>{
 const passages=makePassages(pages),details=[{field:'company',value:'Fictional Atlas Ltd',quote:'Fictional Atlas Ltd',passageId:'p1'},{field:'deadline',value:'2026-12-31',quote:'31 December 2026',passageId:'p1'},{field:'salary',value:'GBP 190,000 per year',quote:'Salary GBP 90,000 per year.',passageId:'p1'},{field:'location',value:'London',quote:'London',passageId:'p1'},{field:'outcome',value:'hired',quote:'hired',passageId:'p1'},{field:'company',value:'Other',quote:'Other',passageId:'p1'}];
 const result=validateIntakeReply({details,uncertainties:['Check OCR against source.']},passages);assert.deepEqual(result.fields,{company:'Fictional Atlas Ltd',deadline:'2026-12-31'});assert.equal(result.evidence[0].page,1);assert.equal(result.evidence[0].method,'ocr');assert.ok(result.uncertainties.length>=4);
 for(const [value,quote] of [['2026-12-31','31 December'],['2026-99-99','31 December 2026']])assert.equal(validateIntakeReply({details:[{field:'deadline',value,quote,passageId:'p1'}],uncertainties:[]},passages).fields.deadline,undefined);
});
test('passages preserve page references while bounding oversized source text',()=>{
 const result=makePassages([{page:1,text:'x'.repeat(400000)},{page:2,text:'SECOND PAGE'}]);assert.ok(result.length>0);assert.ok(result.reduce((n,p)=>n+p.text.length,0)<=300000);assert.equal(result[0].page,1);assert.equal(result[0].id,'p1');
});
test('PDF reading only OCRs sparse pages, preserves original bytes and reports native/OCR limits',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'job-pdf-'));const bytes=Buffer.from('%PDF-fictional'),calls=[];
 try{
  const runner=async(tool,args)=>{calls.push({tool,args});if(tool==='pdfinfo')return {stdout:'Pages: 42\n'};if(tool==='pdftotext'){writeFileSync(args.at(-1),'A native job description with enough text for extraction.\f\f'+'A native job description with enough text for extraction.\f'.repeat(38));return {stdout:''};}if(tool==='pdftoppm'){writeFileSync(args.at(-1)+'.png','fictional pixels');return {stdout:''};}if(tool==='tesseract')return {stdout:'Fictional Atlas Ltd\nSenior Architect\nOCR-readable job description.'};};
  const result=await readJobPDF(bytes,folder,{runner});assert.deepEqual(result.ocrPages,[2]);assert.equal(result.pages[1].page,2);assert.match(result.pages[1].text,/Fictional Atlas/);assert.equal(result.totalPages,42);assert.ok(result.warnings.some(w=>w.includes('first 40')));assert.equal(calls.filter(c=>c.tool==='tesseract').length,1);assert.equal(bytes.toString(),'%PDF-fictional');assert.deepEqual(readdirSync(folder),[]);
 }finally{rmSync(folder,{recursive:true,force:true});}
});
test('source attachment failure rolls back the new opportunity and removes any partial managed copies',()=>{
 const root=mkdtempSync(join(tmpdir(),'job-intake-rollback-')),db=new DatabaseSync(':memory:'),id='11111111-1111-4111-8111-111111111111';
 try{
  db.exec('CREATE TABLE records(id TEXT,data TEXT);CREATE TABLE documents(id TEXT,data TEXT)');const folder=join(root,'job-intake-previews',id);mkdirSync(folder,{recursive:true});const original=Buffer.from('Fictional original source.'),text=Buffer.from('Fictional source text.');writeFileSync(join(folder,'original'),original);writeFileSync(join(folder,'text.txt'),text);
  const hash=b=>createHash('sha256').update(b).digest('hex');writeFileSync(join(folder,'review.json'),JSON.stringify({id,expiresAt:Date.now()+10000,source:{name:'source.txt',sha256:hash(original),textSha256:hash(text)},ai:{used:false}}));let count=0;const createdFiles=[];
  const service=createJobIntake({dataDir:root,db,getDocuments:()=>[],createOpportunity:()=>{db.prepare('INSERT INTO records VALUES (?,?)').run('o','{}');return {id:'o'};},getRecord:()=>({id:'o'}),saveDocument:()=>{if(++count===2)throw Error('Fictional full disk');const path=join(root,'managed-copy');writeFileSync(path,'copy');createdFiles.push(path);db.prepare('INSERT INTO documents VALUES (?,?)').run('d','{}');return {id:'d'};},getDocument:()=>({path:createdFiles[0]}),documentPath:d=>d.path});
  assert.throws(()=>service.create({intakeId:id,company:'Fictional',role:'Engineer'}),/full disk/);assert.equal(db.prepare('SELECT count(*) n FROM records').get().n,0);assert.equal(db.prepare('SELECT count(*) n FROM documents').get().n,0);assert.equal(readFileSync(join(folder,'original')).toString(),original.toString());assert.deepEqual(readdirSync(root),['job-intake-previews']);service.close();
 }finally{db.close();rmSync(root,{recursive:true,force:true});}
});

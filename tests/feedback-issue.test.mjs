import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../src/lib/feedback.ts',import.meta.url),'utf8');
const javascript=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {feedbackIssueDraft}=await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);

test('GitHub issue drafts preserve text and page without posting; oversized bodies stay available to copy',()=>{
 const text='Improve filters & spacing? #feedback\nSecond line with café and <tags>.';
 const draft=feedbackIssueDraft({text,page:'settings'}),url=new URL(draft.url);
 assert.equal(url.origin,'https://github.com');
 assert.equal(url.pathname,'/codefitz/opportunity-knox/issues/new');
 assert.equal(url.searchParams.get('title'),text.split('\n')[0]);
 assert.equal(url.searchParams.get('body'),text+'\n\n---\nPage: settings');
 assert.equal(draft.bodyIncluded,true);
 const long=feedbackIssueDraft({text:'漢'.repeat(6000),page:'library'});
 assert.equal(long.bodyIncluded,false);
 assert.equal(new URL(long.url).searchParams.has('body'),false);
 assert.equal(long.body,'漢'.repeat(6000)+'\n\n---\nPage: library');
 assert.ok(long.title.length<=100);
});

test('edited or AI-written issue text is used verbatim in the GitHub draft link',()=>{
 const draft=feedbackIssueDraft({title:'Edited title & question?',body:'Edited Markdown\n\n## Expected behaviour\nClearer labels.'});
 const url=new URL(draft.url);
 assert.equal(url.searchParams.get('title'),'Edited title & question?');
 assert.equal(url.searchParams.get('body'),'Edited Markdown\n\n## Expected behaviour\nClearer labels.');
});

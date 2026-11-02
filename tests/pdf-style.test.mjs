import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePDFStyleXML,pdfStyleTemplate} from '../server/pdf-style.mjs';
import {layoutDraft,safeWord} from '../server/document-layout.mjs';
const xml='<pdf2xml><page width="595" height="842"><fontspec id="0" size="11" family="ABCDEF+Liberation Sans" color="#202820"/><fontspec id="1" size="24" family="Liberation Serif" color="#204080"/><fontspec id="2" size="14" family="Liberation Sans" color="#204080"/><text font="1" top="42" left="48" width="200">Old Private Name</text><text font="2" top="95" left="48" width="150"><b>Experience</b></text><text font="0" top="120" left="48" width="470">Old factual content must not enter the new document or its metadata.</text><text font="0" top="134" left="48" width="470">More old factual content only used to identify body text formatting.</text></page></pdf2xml>';
test('PDF style references transfer typography and page format without copying old CV claims',async()=>{
 const style=parsePDFStyleXML(xml);assert.equal(style.body.font,'Liberation Sans');assert.equal(style.title.size,24);assert.equal(style.heading.color,'204080');assert.equal(style.page.width,595);assert.equal(style.page.left,48);assert.equal(style.line,14);assert.doesNotMatch(JSON.stringify(style),/Old Private|factual content/);
 const template=await pdfStyleTemplate(style);const result=await safeWord(await layoutDraft('New CV','# New Candidate\n\n## Experience\nVerified new achievement.','previous',template));
 const content=await result.file('word/document.xml').async('string'),styles=await result.file('word/styles.xml').async('string');assert.match(content,/Verified new achievement/);assert.doesNotMatch(content,/Old Private|Old factual|Style sample|Body sample/);assert.match(styles,/Liberation Serif/);assert.match(styles,/204080/);assert.match(content,/w:w="11900"/);
});
test('PDF style matching rejects scanned or invalid layouts rather than claiming a match',()=>{
 assert.throws(()=>parsePDFStyleXML('<pdf2xml><page width="595" height="842"/></pdf2xml>'),/no readable text/);
 assert.throws(()=>parsePDFStyleXML('<pdf2xml><page width="bad" height="842"/></pdf2xml>'),/no readable page layout/);
 assert.throws(()=>parsePDFStyleXML('<pdf2xml><page width="999999" height="842"/></pdf2xml>'),/no readable page layout/);
});

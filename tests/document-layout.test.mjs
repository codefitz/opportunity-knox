import test from 'node:test';import assert from 'node:assert/strict';import JSZip from 'jszip';import {layoutDraft,safeWord,layouts} from '../server/document-layout.mjs';
test('built-in layouts preserve factual content and produce distinct editable Word styles',async()=>{const hashes=new Set();for(const layout of layouts){const bytes=await layoutDraft('Fictional CV','# Fictional Candidate\n\n## Experience\n- Fixed a fictional reporting bug.',layout.id);const z=await safeWord(bytes);const xml=await z.file('word/document.xml').async('string');assert.match(xml,/Fixed a fictional reporting bug/);hashes.add((await z.file('word/styles.xml').async('string'))+xml);}assert.equal(hashes.size,4);});
test('marked templates preserve tables, headers, margins and surrounding text without exposing XML injection',async()=>{const template=await JSZip.loadAsync(await layoutDraft('Fictional template','{{content}}','classic'));let xml=await template.file('word/document.xml').async('string');xml=xml.replace('<w:body>','<w:body><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Fixed fictional sidebar</w:t></w:r></w:p></w:tc></w:tr></w:tbl>');template.file('word/document.xml',xml);const originalStyles=await template.file('word/styles.xml').async('string');const result=await JSZip.loadAsync(await layoutDraft('Fictional CV','A & B <script>\n- Fictional achievement','custom',await template.generateAsync({type:'nodebuffer'})));const rendered=await result.file('word/document.xml').async('string');assert.match(rendered,/Fixed fictional sidebar/);assert.match(rendered,/A &amp; B &lt;script&gt;/);assert.ok(!rendered.includes('{{content}}'));assert.equal(await result.file('word/styles.xml').async('string'),originalStyles);});
test('custom templates need an explicit unique slot and unsafe external resources are rejected',async()=>{const bytes=await layoutDraft('No marker','Fictional unmarked original','classic');await assert.rejects(()=>layoutDraft('CV','Fictional text','custom',bytes),/exactly one paragraph/);const zip=await JSZip.loadAsync(bytes);zip.file('word/_rels/unsafe.rels','<Relationships><Relationship TargetMode="External" Type="image" Target="http://127.0.0.1/private"/></Relationships>');await assert.rejects(()=>safeWord(Buffer.from('invalid')),/readable DOCX/);await assert.rejects(()=>zip.generateAsync({type:'nodebuffer'}).then(safeWord),/externally linked/);});
test('Word preview rejects external field instructions and namespaced external relationships',async()=>{const bytes=await layoutDraft('Fictional','Fictional text','classic');const z=await JSZip.loadAsync(bytes);const xml=await z.file('word/document.xml').async('string');z.file('word/document.xml',xml.replace('<w:body>','<w:body><w:p><w:r><w:instrText>INCLUDETEXT file:///data/private</w:instrText></w:r></w:p>'));await assert.rejects(()=>z.generateAsync({type:'nodebuffer'}).then(safeWord),/externally linked fields/);z.file('word/document.xml',xml);z.file('word/_rels/blocked.rels','<r:Relationships xmlns:r="http://schemas.openxmlformats.org/package/2006/relationships"><r:Relationship TargetMode="External" Type="image" Target="http://127.0.0.1/private"/></r:Relationships>');await assert.rejects(()=>z.generateAsync({type:'nodebuffer'}).then(safeWord),/externally linked/);});
test('previous CV styling reuses typography and page settings without carrying over old document text',async()=>{
 const previous=await JSZip.loadAsync(await layoutDraft('Old personal CV','# Previous Candidate\n\n## Experience\nOld confidential employment details.','executive'));
 const original=await previous.file('word/document.xml').async('string');
 previous.file('word/document.xml',original.replace('w:left="1100"','w:left="1600"'));
 const result=await safeWord(await layoutDraft('New CV','# New Candidate\n\n## Experience\n- New verified achievement.','previous',await previous.generateAsync({type:'nodebuffer'})));
 const xml=await result.file('word/document.xml').async('string');
 assert.match(xml,/New verified achievement/);assert.doesNotMatch(xml,/Previous Candidate|Old confidential/);assert.match(xml,/w:left="1600"/);
 assert.equal(await result.file('word/styles.xml').async('string'),await previous.file('word/styles.xml').async('string'));
 await assert.rejects(()=>layoutDraft('CV','New content','previous'),/previous Word CV/);
});
test('structured templates with tables preserve sidebar columns and layout containers',async()=>{
 const templateZip=await JSZip.loadAsync(await layoutDraft('Template','# Old Person\n\n## Experience\nOld data.','classic'));
 let xml=await templateZip.file('word/document.xml').async('string');
 const tableXml='<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/></w:tblPr><w:tr><w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/><w:shd w:fill="E0E6ED"/></w:tcPr><w:p><w:pPr><w:b/></w:pPr><w:r><w:t>SKILLS</w:t></w:r></w:p><w:p><w:r><w:t>Old skill 1</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:w="6000" w:type="dxa"/></w:tcPr><w:p><w:pPr><w:b/></w:pPr><w:r><w:t>EXPERIENCE</w:t></w:r></w:p><w:p><w:r><w:t>Old job 1</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
 xml=xml.replace('</w:body>',tableXml+'</w:body>');
 templateZip.file('word/document.xml',xml);
 const templateBytes=await templateZip.generateAsync({type:'nodebuffer'});
 const resultBytes=await layoutDraft('New Candidate','# Verified Candidate\n\n## Skills\n- TypeScript & React\n- Node & SQL\n\n## Experience\n- Lead Developer on verified platform.','previous',templateBytes);
 const resultZip=await safeWord(resultBytes);
 const resultXml=await resultZip.file('word/document.xml').async('string');
 assert.match(resultXml,/<w:tbl/);
 assert.match(resultXml,/w:fill="E0E6ED"/);
 assert.match(resultXml,/TypeScript &amp; React/);
 assert.match(resultXml,/Lead Developer on verified platform/);
 assert.doesNotMatch(resultXml,/Old skill 1|Old job 1/);
});

test('executive template with multi-row experience table and sidebar vMerge preserves layout without retaining dummy text', async () => {
 const templateZip = await JSZip.loadAsync(await layoutDraft('Executive Template', '# Dummy\n\nDummy text.', 'classic'));
 let xml = await templateZip.file('word/document.xml').async('string');
 const headerXml = '<w:p><w:r><w:t xml:space="preserve">CHARLOTTE </w:t></w:r><w:r><w:t>EXECUTE</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>Chief Marketing Officer</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>111 Pine St. New York, NY | (555)999-9999 | c@email.com</w:t></w:r></w:p>';
 const tableXml = '<w:tbl>' +
  '<w:tr><w:tc><w:p><w:r><w:t>Work Experience</w:t></w:r></w:p></w:tc><w:tc><w:p/></w:tc><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>Sidebar</w:t></w:r></w:p></w:tc></w:tr>' +
  '<w:tr><w:tc><w:p><w:r><w:t>2014 - Present</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Marketing Consultancy Inc.</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc></w:tr>' +
  '<w:tr><w:tc><w:p/></w:tc><w:tc><w:p><w:r><w:t>Chief Marketing Officer</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc></w:tr>' +
  '<w:tr><w:tc><w:p/></w:tc><w:tc><w:p><w:r><w:t>Duties: Responsible for digital marketing.</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc></w:tr>' +
  '<w:tr><w:tc><w:p><w:r><w:t>EDUCATION</w:t></w:r></w:p></w:tc><w:tc><w:p/></w:tc><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc></w:tr>' +
  '<w:tr><w:tc><w:p><w:r><w:t>May 2010</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Stanford University</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc></w:tr>' +
  '<w:tr><w:tc><w:p/></w:tc><w:tc><w:p><w:r><w:t>MBA</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc></w:tr>' +
  '<w:tr><w:tc><w:p/></w:tc><w:tc><w:p><w:r><w:t>Summa Cum Laude</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc></w:tr>' +
  '</w:tbl>';
 xml = xml.replace('</w:body>', headerXml + tableXml + '</w:body>');
 templateZip.file('word/document.xml', xml);
 const templateBytes = await templateZip.generateAsync({ type: 'nodebuffer' });

 const candidateMd = '# Wayne Fitzpatrick\nTechnology Consultant & Enterprise Architect\nwayne@example.com | +44 7000 000000 | London, UK\n\n' +
  '## Professional Summary\nExperienced technology consultant.\n\n' +
  '## Work Experience\n' +
  '### Principal Architect | Global Consulting\n2020 – Present\n- Led enterprise cloud platforms.\n\n' +
  '## Education\n- University of Liverpool: MSc Artificial Intelligence — expected Nov 2027';

 const resultBytes = await layoutDraft('New Candidate', candidateMd, 'previous', templateBytes);
 const resultZip = await safeWord(resultBytes);
 const resultXml = await resultZip.file('word/document.xml').async('string');

 assert.match(resultXml, /Wayne/);
 assert.match(resultXml, /Fitzpatrick/);
 assert.match(resultXml, /Technology Consultant &amp; Enterprise Architect/);
 assert.match(resultXml, /wayne@example.com/);
 assert.match(resultXml, /Global Consulting/);
 assert.match(resultXml, /Principal Architect/);
 assert.match(resultXml, /Led enterprise cloud platforms/);
 assert.match(resultXml, /University of Liverpool/);
 assert.match(resultXml, /MSc Artificial Intelligence/);
 assert.doesNotMatch(resultXml, /CHARLOTTE|EXECUTE|Marketing Consultancy|Stanford University/);
});

test('Previous Experience section is preserved in layouts and parsed as distinct from recent experience', async () => {
 const candidateMd = '# Fictional Candidate\nSoftware Engineer\ncand@example.com\n\n' +
  '## Experience\n' +
  '### Senior Engineer | Modern Corp | 2021 - Present\n- Built high throughput data pipelines.\n\n' +
  '## Previous Experience\n' +
  '### Junior Developer | Legacy Inc | 2011 - 2014\n' +
  '### Intern | Ancient Tech | 2009 - 2010\n' +
  '• Maintained legacy Java backend and SQL stored procedures.\n\n' +
  '## Education\n- BSc Computer Science — Fictional University';

 const classicBytes = await layoutDraft('Candidate CV', candidateMd, 'classic');
 const classicZip = await safeWord(classicBytes);
 const classicXml = await classicZip.file('word/document.xml').async('string');

 assert.match(classicXml, /Experience/);
 assert.match(classicXml, /Modern Corp/);
 assert.match(classicXml, /Previous Experience/);
 assert.match(classicXml, /Legacy Inc/);
 assert.match(classicXml, /Ancient Tech/);
 assert.match(classicXml, /Maintained legacy Java backend/);
});

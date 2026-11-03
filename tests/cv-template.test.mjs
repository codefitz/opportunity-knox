import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from 'cheerio';
import { layoutDraft, safeWord } from '../server/document-layout.mjs';
import { readCVTemplate, populateCVTemplate, deriveTemplate } from '../server/cv-template.mjs';

test('CV template population edits text only, including headers, while preserving Word layout and rejecting incomplete output', async () => {
  const zip = await safeWord(await layoutDraft('Template', '# Example Person\n\nExample experience.', 'executive'));
  let xml = await zip.file('word/document.xml').async('string');
  xml = xml.replace('</w:body>', '<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/></w:tblPr><w:tr><w:tc><w:tcPr><w:shd w:fill="123456"/></w:tcPr><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Old skill</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t> detail</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body>');
  zip.file('word/document.xml', xml);
  zip.file('word/header1.xml', '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Old contact</w:t></w:r></w:p></w:hdr>');
  const bytes = await zip.generateAsync({type:'nodebuffer'});
  const { slots } = await readCVTemplate(bytes);
  const replacements = slots.map(s => ({id:s.id,text:s.text==='Old contact'?'new@example.test':'Verified & <safe> replacement'}));
  const result = await safeWord(await populateCVTemplate(bytes, 'Reviewed factual CV', async (_, system, payload) => {
    assert.match(system, /replacing text only/);
    assert.deepEqual(payload.slots, slots);
    return JSON.stringify({replacements});
  }));
  // Removing text nodes must leave the complete original layout tree unchanged.
  const structure = value => {const $=load(value,{xml:true});$('w\\:t').remove();return $.xml();};
  assert.equal(structure(await result.file('word/document.xml').async('string')), structure(xml));
  for (const file of Object.values(zip.files).filter(f=>!f.dir && !['word/document.xml','word/header1.xml'].includes(f.name)))
    assert.deepEqual(await result.file(file.name).async('nodebuffer'), await file.async('nodebuffer'));
  assert.match(await result.file('word/header1.xml').async('string'), /new@example.test/);
  const $=load(await result.file('word/document.xml').async('string'),{xml:true});
  assert.equal($('w\\:tbl w\\:p').text(), 'Verified & <safe> replacement');
  await assert.rejects(()=>populateCVTemplate(bytes,'CV',async()=>JSON.stringify({replacements:replacements.slice(1)})),/incomplete template/);
  await assert.rejects(()=>populateCVTemplate(bytes,'CV',async()=>JSON.stringify({replacements:replacements.map(r=>({...r,id:0}))})),/incomplete template/);
});

test('long names and additional history expand in the existing cell with template formatting', async () => {
  const zip = await safeWord(await layoutDraft('Template', 'Example', 'classic'));
  let xml = await zip.file('word/document.xml').async('string');
  xml = xml.replace('</w:body>', '<w:tbl><w:tr><w:tc><w:tcPr><w:shd w:fill="123456"/></w:tcPr><w:p><w:pPr><w:spacing w:after="80"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Job</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body>');
  zip.file('word/document.xml', xml);
  const bytes = await zip.generateAsync({type:'nodebuffer'});
  const output = await populateCVTemplate(bytes, 'Complete fictional history', async (_, system, {slots}) => {
    assert.match(system, /NEVER character limits/);
    return JSON.stringify({replacements: slots.map(s=>({id:s.id,text:s.text==='Job'?'First employer — 2020–2022\nSecond employer — 2022–2024\nThird employer — 2024–Present':'A Fictional Candidate With A Longer Name'}))});
  });
  const result = await safeWord(output);
  const $=load(await result.file('word/document.xml').async('string'),{xml:true});
  assert.equal($('w\\:tbl').length,1);
  assert.equal($('w\\:tc').length,1);
  assert.equal($('w\\:tc w\\:p').length,3);
  assert.equal($('w\\:tc w\\:b').length,3);
  assert.equal($('w\\:tc w\\:spacing[w\\:after="80"]').length,3);
  assert.match($('w\\:tc').text(),/Third employer/);
  assert.match($('w\\:body').text(),/A Fictional Candidate With A Longer Name/);
});

test('deriveTemplate sanitizes private details into neutral template slots while preserving layout and headings', async () => {
  const originalCV = '# Dr. Alex Fictional\nTechnology Leader & Principal Architect\nalex@private-domain.test | +44 7700 900000 | London, UK\n\n' +
    '## Professional Summary\nAccomplished leader driving distributed cloud systems at scale.\n\n' +
    '## Work Experience\n' +
    '### Principal Architect | Fictional Tech Global\n2021 – Present\n- Led 20 engineers and scaled platform to 10M events.\n\n' +
    '## Education\n- MSc Computer Science — University of London (2017)';

  const sourceBytes = await layoutDraft('Dr Alex Fictional CV', originalCV, 'classic');
  const templateBytes = await deriveTemplate(sourceBytes, { isCoverLetter: false });
  const resultZip = await safeWord(templateBytes);
  const docXml = await resultZip.file('word/document.xml').async('string');

  // Headings preserved
  assert.match(docXml, /Professional Summary/);
  assert.match(docXml, /Work Experience/);
  assert.match(docXml, /Education/);

  // Placeholders inserted
  assert.match(docXml, /\[Candidate Full Name\]/);
  assert.match(docXml, /\[Professional Title \/ Target Role\]/);
  assert.match(docXml, /\[Email Address\]/);
  assert.match(docXml, /\[Job Title\] \| \[Company Name\]/);
  assert.match(docXml, /\[Month Year (?:–|&#x2013;|-) Present\]/);

  // Private data eradicated
  assert.doesNotMatch(docXml, /Alex Fictional/);
  assert.doesNotMatch(docXml, /private-domain\.test/);
  assert.doesNotMatch(docXml, /Fictional Tech Global/);
  assert.doesNotMatch(docXml, /Led 20 engineers/);
});

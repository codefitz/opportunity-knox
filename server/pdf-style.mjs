import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {load} from "cheerio";
import {Document,Paragraph,HeadingLevel,Packer} from "docx";
const run=promisify(execFile);
const fail=message=>{throw Object.assign(new Error(message),{status:422});};
const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
export function parsePDFStyleXML(xml){
  const $=load(xml,{xml:true}),page=$("page").first();
  const width=Number(page.attr("width")),height=Number(page.attr("height"));
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<200||height<200||width>2000||height>3000)fail("This PDF has no readable page layout.");
  const fonts=new Map();
  $("fontspec").each((_,f)=>{
    const family=($(f).attr("family")||"Liberation Sans").replace(/^[A-Z]{6}\+/,"").replace(/[-,]?(BoldItalic|BoldOblique|SemiBold|DemiBold|Bold|Italic|Oblique|Regular|Medium|Light)(MT)?$/i,"").replace(/MT$/," ").trim().slice(0,100);
    const size=Number($(f).attr("size")),color=($(f).attr("color")||"#202820").replace(/^#/,"");
    if(Number.isFinite(size)&&size>=5&&size<=80)fonts.set($(f).attr("id"),{font:family||"Liberation Sans",size,color:/^[a-f0-9]{6}$/i.test(color)?color:"202820"});
  });
  const lines=page.find("text").toArray().map(t=>({style:fonts.get($(t).attr("font")),text:$(t).text().trim(),left:Number($(t).attr("left")),top:Number($(t).attr("top")),width:Number($(t).attr("width")),bold:$(t).find("b").length>0})).filter(t=>t.style&&t.text&&[t.left,t.top,t.width].every(Number.isFinite));
  if(!lines.length)fail("This PDF has no readable text for style matching. Choose a text-based PDF or another CV.");
  // ponytail: recreate a single text flow from typography; complex graphics need structural reconstruction.
  const scores=new Map();
  for(const line of lines)if(line.style.size<=18)scores.set(line.style,(scores.get(line.style)||0)+line.text.length);
  const body=[...scores].sort((a,b)=>b[1]-a[1])[0]?.[0]||lines[0].style;
  const topLines=lines.filter(l=>l.top<height*.3);
  const title=[...topLines].sort((a,b)=>b.style.size-a.style.size)[0]?.style||body;
  const heading=lines.find(l=>l.style.size>body.size+.4&&l.style.size<title.size&&l.text.length<100)?.style||lines.find(l=>l.bold&&l.text.length<80)?.style||body;
  const left=clamp(Math.min(...lines.map(l=>l.left)),24,90);
  const right=clamp(width-Math.max(...lines.map(l=>l.left+l.width)),24,90);
  const bodyLines=lines.filter(l=>l.style===body).sort((a,b)=>a.top-b.top);
  const gaps=bodyLines.slice(1).map((l,i)=>l.top-bodyLines[i].top).filter(g=>g>=body.size&&g<=body.size*2).sort((a,b)=>a-b);
  return {body,title,heading,page:{width,height,top:clamp(Math.min(...lines.map(l=>l.top)),24,90),bottom:36,left,right},line:clamp(gaps[Math.floor(gaps.length/2)]||body.size*1.25,body.size,body.size*1.8)};
}
export async function extractPDFStyle(bytes){
  if(bytes.length>20*1024*1024||!bytes.subarray(0,1024).includes(Buffer.from("%PDF-")))fail("Choose a readable PDF up to 20 MB for style matching.");
  const folder=mkdtempSync(join(tmpdir(),"knox-pdf-style-"));
  try{
    const file=join(folder,"style.pdf");writeFileSync(file,bytes,{mode:0o600});
    let xml;
    try{xml=(await run("pdftohtml",["-xml","-i","-f","1","-l","2","-zoom","1","-stdout",file],{timeout:20000,maxBuffer:4*1024*1024})).stdout;}
    catch{fail("Could not read this PDF’s style. Try a different PDF or Word CV.");}
    return parsePDFStyleXML(xml);
  }finally{rmSync(folder,{recursive:true,force:true});}
}
export async function pdfStyleTemplate(style){
  const run=s=>({font:s.font,size:Math.round(clamp(s.size,6,40)*2),color:s.color});
  const twips=n=>Math.round(n*20),p=style.page;
  return Packer.toBuffer(new Document({
    styles: {default: {
      document: {run:run(style.body),paragraph:{spacing:{line:twips(style.line)}}},
      title: {run:{...run(style.title),bold:true}},
      heading1: {run:{...run(style.heading),bold:true},paragraph:{spacing:{before:120,after:80}}},
    }},
    sections: [{
      properties: {page:{size:{width:twips(p.width),height:twips(p.height)},margin:{top:twips(p.top),bottom:twips(p.bottom),left:twips(p.left),right:twips(p.right)}}},
      children: [new Paragraph({text:"Style sample",heading:HeadingLevel.TITLE}),new Paragraph({text:"Section",heading:HeadingLevel.HEADING_1}),new Paragraph("Body sample used only to carry typography and spacing.")],
    }],
  }));
}

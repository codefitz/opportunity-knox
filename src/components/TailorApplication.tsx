import { useEffect, useState } from "react";
import { api, json } from "../api";
import type { Opportunity } from "../types";
import DocumentThumbnail from "./DocumentThumbnail";
import AIRequestProgress from "./AIRequestProgress";
const classic = new URL("../assets/templates/classic.png", import.meta.url).href;
const compact = new URL("../assets/templates/compact.png", import.meta.url).href;
const executive = new URL("../assets/templates/executive.png", import.meta.url).href;

type CVStyle = {id:string;name:string;revision:number;version:number;thumbnailUrl:string;reusable:boolean;format:string};
type Draft = {
  id: string;
  requestId: string;
  content: string;
  draft: { kind: string; title: string; content: string };
  editedDraft?: {title:string;content:string};
  tailoring: { styleDocumentId?:string;styleDocumentRevision?:number;styleDocumentName?:string;groupId?:string; sourceCvId: string; sourceCvName: string; layout: string };
  savedDocuments: { id: string; name: string; url: string }[];
};
const templates = [
  { id: "classic", name: "Classic", description: "Spacious, single column", image: classic },
  { id: "compact", name: "Compact", description: "Concise, two-page target", image: compact },
  { id: "executive", name: "Executive", description: "Restrained Montserrat", image: executive },
];
export default function TailorApplication({ opportunity, onSaved, onError }: {
  opportunity: Opportunity;
  onSaved: (ids: string[], cover: boolean) => Promise<void>;
  onError: (e: unknown) => void;
}) {
  const [layout, setLayout] = useState("auto");
  const [expanded,setExpanded]=useState(false);
  const [previousCVs,setPreviousCVs]=useState<CVStyle[]>([]);
  const [styleId,setStyleId]=useState("");
  const [cvQuery,setCVQuery]=useState("");
  const [shown,setShown]=useState(12);
  useEffect(()=>{if(expanded)void api<{documents:CVStyle[]}>("/document-studio/cv-styles").then(r=>setPreviousCVs(r.documents)).catch(onError);},[expanded,opportunity.revision]);
  const [cover, setCover] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const base = `/opportunities/${opportunity.id}/buddy`;
  useEffect(() => {
    let live=true;
    void api<{messages:Draft[]}>(base).then(result=>{
      if(!live)return;
      const tailored=result.messages.filter(m=>m.tailoring?.groupId&&m.draft?.kind!=="none");
      const group=tailored.at(-1)?.tailoring.groupId;
      if(group){
        const restored=tailored.filter(m=>m.tailoring.groupId===group).map(m=>({...m,draft:m.editedDraft?{...m.draft,...m.editedDraft}:m.draft}));
        setDrafts(restored);setLayout(restored[0].tailoring.layout);setStyleId(restored[0].tailoring.styleDocumentId||"");setCover(restored.some(m=>m.draft.kind==="cover"));
        setStatus("Previous AI drafts restored. Review or edit them before saving.");
      }
    }).catch(onError);
    return ()=>{live=false;};
  }, [opportunity.id]);
  async function generate() {
    setBusy(true); setError(""); setSaved(false);
    const completed: Draft[] = [];
    try {
      for (const action of cover ? ["cv", "cover"] : ["cv"]) {
        setStatus(action === "cv" ? "Choosing your source CV and tailoring a new draft…" : "Drafting the optional cover letter…");
        const id = crypto.randomUUID(); setRequestId(id);
        const result = await api<{messages: Draft[]}>(base + "/chat", json({
          action, requestId: id, tailoringGroupId: completed[0]?.requestId || id, autoTailor: true, templateLayout: completed[0]?.tailoring.layout || layout,
          ...(completed[0] ? {sourceCvId: completed[0].tailoring.sourceCvId} : {}),
          ...(action==="cv"&&styleId?{styleDocumentId:styleId,styleDocumentRevision:previousCVs.find(d=>d.id===styleId)?.revision}:{}),
          documentIds: [], includeOtherOpportunities: false,
          message: action === "cv" ? "Tailor a new complete CV for this opportunity using the best source CV and verified career evidence. Preserve factual history and identity."
            : "Write a concise cover letter for this opportunity using the chosen source CV and verified evidence.",
        }));
        const draft = result.messages.find(m => m.requestId === id && m.draft?.kind === action);
        if (!draft) throw new Error("AI did not return a complete document. Check Career Buddy for its explanation before retrying.");
        completed.push(draft); setDrafts([...completed]);
      }
      setStatus("Your drafts are ready. Review the text before saving.");
    } catch(e) {
      setError(e instanceof Error ? e.message : "Could not tailor documents."); onError(e);
    } finally { setBusy(false); }
  }
  async function save() {
    setBusy(true); setError("");
    const ids: string[] = [];
    try {
      for (const draft of drafts) {
        const result = await api<{messages: Draft[]}>(base + "/draft/" + draft.id, json({ title: draft.draft.title, content: draft.draft.content, layout: draft.tailoring.layout }));
        const stored = result.messages.find(m => m.id === draft.id)!;
        ids.push(stored.savedDocuments.at(-1)!.id);
        setDrafts(current => current.map(d => d.id === draft.id ? {...d, savedDocuments: stored.savedDocuments} : d));
      }
      await onSaved(ids, drafts.some(d => d.draft.kind === "cover"));
      setSaved(true); setStatus("Saved new drafts and an application ready for review. Your source CV is unchanged.");
    } catch(e) { setError(e instanceof Error ? e.message : "Could not save drafts."); onError(e); }
    finally { setBusy(false); }
  }
  const matchingCVs=previousCVs.filter(d=>d.name.toLowerCase().includes(cvQuery.toLowerCase()));
  return <details className="tailor-application" open={expanded} onToggle={e=>{if(e.target===e.currentTarget)setExpanded(e.currentTarget.open);}}>
    <summary>Tailor a new CV{busy?" · Working…":""}</summary>
    <p>AI chooses a suitable source CV and relevant career evidence. Add a cover letter if you need one.</p>
    <label className="check-label"><input type="checkbox" checked={cover} disabled={busy} onChange={e => setCover(e.target.checked)} /> Include a cover letter</label>
    <div className="form-actions"><button type="button" className="button primary" disabled={busy} onClick={() => void generate()}>{busy ? "Working…" : drafts.length ? "Tailor a fresh version" : "Tailor my CV with AI"}</button></div>
    <fieldset disabled={busy} className="cv-style-choices">
      <legend>Choose a style</legend>
      <h4>Templates</h4>
      <div className="cv-style-strip" aria-label="CV templates" tabIndex={0}>
        <label className={`template-option template-auto ${!styleId&&layout === "auto" ? "selected" : ""}`}>
          <input type="radio" name={`template-${opportunity.id}`} checked={!styleId&&layout === "auto"} onChange={() => {setStyleId("");setLayout("auto");}} />
          <strong>Let AI choose</strong><span>Match a layout to your CV and this role</span>
        </label>
        {templates.map(t => <label key={t.id} className={`template-option ${!styleId&&layout === t.id ? "selected" : ""}`}>
          <img src={t.image} alt={`${t.name} CV layout preview with fictional sample content`} />
          <span><input type="radio" name={`template-${opportunity.id}`} checked={!styleId&&layout === t.id} onChange={() => {setStyleId("");setLayout(t.id);}} /> <strong>{t.name}</strong></span>
          <small>{t.description}</small>
        </label>)}
      </div>
      <h4>Previous CVs</h4>
      <p>Choose a CV to reuse its style. PDF typography and page settings are recreated in Word; complex graphics and sidebars may simplify.</p>
      {previousCVs.length>0 && <label className="field"><span>Find a previous CV style</span><input type="search" value={cvQuery} onChange={e=>{setCVQuery(e.target.value);setShown(12);}} placeholder="Filter CV thumbnails" /></label>}
      <div className="cv-style-strip" aria-label="Previous CV styles" tabIndex={0}>
        {matchingCVs.slice(0,shown).map(d=><label key={d.id} className={`template-option previous-cv-option ${styleId===d.id?"selected":""}`}>
          {expanded && <DocumentThumbnail key={`${d.id}:${d.revision}`} id={d.id} name={d.name} revision={d.revision}/>}
          <span>{<input type="radio" name={`template-${opportunity.id}`} checked={styleId===d.id} onChange={()=>{setStyleId(d.id);setLayout("auto");}} />} <strong>{d.name}</strong></span>
          <small>{d.format.toUpperCase()} · Version {d.version}</small>
          {d.format === "pdf" && <small>Use this PDF’s style</small>}
          {d.format === "gdoc" && <small>Uses your Google connection</small>}
        </label>)}
        {matchingCVs.length>shown && <button type="button" className="button secondary small" onClick={()=>setShown(v=>v+12)}>More CVs</button>}
      </div>
      {!matchingCVs.length && <p>{previousCVs.length?"No matching CVs.":"Your CVs will appear here when added to Career Hub."}</p>}
      {styleId && <p role="status">Style selected: {previousCVs.find(d=>d.id===styleId)?.name||"Previous CV"}. AI chooses the factual source CV separately.</p>}
    </fieldset>
    <AIRequestProgress id={requestId} onError={onError}/>
    {error && <p role="alert">{error}</p>}
    {status && <p role="status">{status}</p>}
    {drafts.map(d => <section className="tailored-draft" key={d.id}>
      <h4>{d.draft.kind === "cv" ? "Your tailored CV" : "Your cover letter"}</h4>
      <p>Source: {d.tailoring.sourceCvName} · Layout: {d.draft.kind === "cover" ? "Cover letter" : d.tailoring.styleDocumentName||d.tailoring.layout}</p>
      <details><summary>AI notes and evidence</summary><p className="preserve-lines">{d.content}</p></details>
      <label className="field"><span>Document title</span><input disabled={busy || saved} value={d.draft.title} maxLength={200} onChange={e => setDrafts(current => current.map(x => x.id === d.id ? {...x, draft: {...x.draft, title: e.target.value}} : x))}/></label>
      <label className="field"><span>Review and edit {d.draft.kind === "cv" ? "CV" : "cover letter"}</span><textarea rows={18} disabled={busy || saved} value={d.draft.content} maxLength={60000} onChange={e => setDrafts(current => current.map(x => x.id === d.id ? {...x, draft: {...x.draft, content: e.target.value}} : x))}/></label>
      {d.savedDocuments.map(doc => <a className="button secondary small" key={doc.id} href={doc.url}>Download {doc.name}</a>)}
    </section>)}
    {drafts.length > 0 && !saved && <button type="button" className="button primary" disabled={busy || drafts.some(d => !d.draft.title.trim() || !d.draft.content.trim())} onClick={() => void save()}>Save reviewed drafts</button>}
  </details>;
}

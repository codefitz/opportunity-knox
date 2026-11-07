import { useState } from "react";
import { FileText } from "lucide-react";
export default function DocumentThumbnail({id,name,revision=1,className="",onLoad}:{id:string;name:string;revision?:number;className?:string;onLoad?:()=>void}){
  const [failed,setFailed]=useState(false);
  if(failed||!/\.(docx|dotx|pdf|gdoc|gsheet|gslides)$/i.test(name))
    return <span className={`document-thumbnail-fallback ${className}`} role="img" aria-label={`Preview unavailable for ${name}`} title={/\.(gdoc|gsheet|gslides)$/i.test(name)?"Connect Google Docs in Career Hub to preview this shortcut.":"Preview unavailable for this file."}><FileText size={22}/></span>;
  return <img className={`document-thumbnail ${className}`} src={`/api/document-studio/thumbnails/${encodeURIComponent(id)}?revision=${revision}`} loading="lazy" alt={`First-page preview of ${name}`} onLoad={onLoad} onError={()=>setFailed(true)}/>;
}

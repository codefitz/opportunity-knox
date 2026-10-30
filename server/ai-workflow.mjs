const defaults={revision:1,intake:true,fit:true,drafting:true,autoFit:true,autoTags:true};
export const workflowSettings=getConfig=>({...defaults,...getConfig('aiWorkflow')});
export function requireAIStage(getConfig,stage){if(!workflowSettings(getConfig)[stage])throw Object.assign(new Error(({intake:'Job extraction',fit:'Fit and role advice',drafting:'CV and cover-letter drafting'})[stage]+' is disabled in Settings → AI workflow.'),{status:403});}
export function createAIWorkflow({getConfig,putConfig}){return{async handle(path,method,req,res,{json,readBody}){
 if(path!=='/api/ai-workflow')return false;
 const current=workflowSettings(getConfig);
 if(method==='GET'){json(res,current);return true;}
 const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
 if(method!=='PATCH')fail(405,'Use Save AI workflow.');
 const body=await readBody(req);if(body.revision!==current.revision)fail(409,'AI workflow settings changed. Reload before saving.');
 if(Object.keys(body).some(k=>!Object.hasOwn(defaults,k))||Object.entries(body).some(([k,v])=>k!=='revision'&&typeof v!=='boolean'))fail(400,'Choose valid AI workflow switches.');
 const next={...current,...body,revision:current.revision+1};putConfig('aiWorkflow',next);json(res,next);return true;
}};}

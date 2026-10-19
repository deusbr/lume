const fs=require('node:fs');
const path=require('node:path');
const {text,atomicWrite}=require('./store.cjs');
function readHandoff(directory,id,now=Date.now()){
  if(!/^[a-f0-9-]{36}$/.test(id||''))throw new Error('Identificador externo inválido.');
  const target=path.join(directory,`${id}.json`);let data;
  try{const st=fs.lstatSync(target);if(!st.isFile()||st.isSymbolicLink()||st.size>2*1024*1024||now-st.mtimeMs>15*60*1000)throw new Error('Pedido externo expirado ou inválido.');data=JSON.parse(fs.readFileSync(target,'utf8'));}
  finally{try{fs.unlinkSync(target);}catch{}}
  if(![1,2].includes(data.version))throw new Error('Versão de pedido externo incompatível.');
  const payload={assistantId:text(data.assistantId,200),prompt:text(data.prompt,16000),goal:text(data.goal,16000),context:text(data.context,128000),newAssistant:data.newAssistant&&{name:text(data.newAssistant.name,120),instructions:text(data.newAssistant.instructions),knowledge:text(data.newAssistant.knowledge,128000),description:text(data.newAssistant.description,400)}};
  if(data.version===2){
    payload.mode=['conversation','meeting','summary','code-review','study','followup'].includes(data.mode)?data.mode:'conversation';
    payload.source=text(data.source,120);
    payload.files=Array.isArray(data.files)?data.files.slice(0,8).filter(f=>f&&typeof f.name==='string'&&typeof f.text==='string').map(f=>({kind:'text',name:text(f.name,200).replace(/[\\/\0]/g,'_'),text:text(f.text,128000),mime:'text/plain'})):[];
    if(payload.newAssistant){const aliases={realtimePrompt:'insightInstructions',followUpPrompt:'questionInstructions',summaryPrompt:'summaryInstructions',toolsPrompt:'toolInstructions'};for(const [key,alias]of Object.entries(aliases))payload.newAssistant[key]=text(data.newAssistant[key]||data.newAssistant[alias],32000);}
  }
  return payload;
}
function writeBridge(directory,{executable,appRoot,packaged,assistants}){const folder=path.join(directory,'integrations');fs.mkdirSync(folder,{recursive:true});fs.mkdirSync(path.join(directory,'handoffs'),{recursive:true});atomicWrite(path.join(folder,'bridge.json'),JSON.stringify({version:2,executable,appRoot,packaged,handoffDir:path.join(directory,'handoffs'),assistants:assistants.map(a=>({id:a.id,name:a.name})),handoffVersions:[1,2],reviewRequired:true},null,2));}
module.exports={readHandoff,writeBridge};

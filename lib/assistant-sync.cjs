const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {atomic}=require('./secret-vault.cjs');
const PREFERENCES=['theme','uiLanguage','language','translationLanguage','translate','autoSuggest','insightMode','insightEnabled','insightMinVisibleSeconds','insightTriggers','summaryLive','contentProtection','overlayOpacity','overlayClickThrough','overlayPinned','hideTaskbar','minimizeToTray','voiceMode','shortcuts'];
const ASSISTANT_FIELDS=['id','name','description','category','icon','color','instructions','knowledge','realtimePrompt','followUpPrompt','summaryPrompt','toolsPrompt','requireCertainty'];
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));return value;}
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(stable(value===undefined?null:value))).digest('hex');
function cleanAssistant(input){const out={};for(const key of ASSISTANT_FIELDS)if(['string','boolean'].includes(typeof input[key]))out[key]=input[key];if(Array.isArray(input.files))out.files=input.files.slice(0,30).filter(f=>f&&typeof f.name==='string'&&typeof f.text==='string').map(f=>({id:typeof f.id==='string'?f.id:undefined,name:f.name.slice(0,240),text:f.text.slice(0,256000)}));return out;}
function portablePreferences(input){const out={};for(const key of PREFERENCES){const value=input?.[key];if(['string','number','boolean'].includes(typeof value))out[key]=typeof value==='string'?value.slice(0,500):value;else if(key==='shortcuts'&&value&&typeof value==='object'&&!Array.isArray(value))out[key]=Object.fromEntries(Object.entries(value).slice(0,30).filter(([k,v])=>/^[\w.-]{1,80}$/.test(k)&&typeof v==='string'&&v.length<=120&&!/[\\/]/.test(v)));else if(key==='insightTriggers'&&value&&typeof value==='object')out[key]=Object.fromEntries(['questions','periodic','silence','screen'].filter(k=>typeof value[k]==='boolean').map(k=>[k,value[k]]));}return out;}
class AssistantSync {
  constructor({store,profileId,assertCurrent=()=>{},deviceId}){Object.assign(this,{store,profileId,assertCurrent});this.deviceId=deviceId||crypto.createHash('sha256').update(require('node:os').hostname()+profileId).digest('hex').slice(0,16);}
  folder(){const folder=this.store.getMeta('sync.folder');if(!folder||!fs.existsSync(folder)||!fs.statSync(folder).isDirectory())throw new Error('Escolha uma pasta para sincronizar.');return fs.realpathSync(folder);}
  choose(folder){this.assertCurrent();if(!fs.statSync(folder).isDirectory())throw new Error('Escolha uma pasta.');this.store.setMeta('sync.folder',fs.realpathSync(folder));this.store.setMeta('sync.base',{});return this.status();}
  local(){const assistants=this.store.assistants?this.store.assistants():this.store.snapshot().assistants;return {assistants:Object.fromEntries(assistants.map(a=>[a.id,cleanAssistant(a)])),preferences:portablePreferences(this.store.snapshot().settings)};}
  read(){const file=path.join(this.folder(),'lume-sync-v1.json');if(!fs.existsSync(file))return {format:'lume-sync',version:1,revision:'',assistants:{},preferences:{}};if(fs.statSync(file).size>12*1024*1024)throw new Error('O arquivo de sincronização ultrapassa 12 MB.');const data=JSON.parse(fs.readFileSync(file,'utf8'));if(data.format!=='lume-sync'||data.version!==1||!data.assistants||!data.preferences)throw new Error('Formato de sincronização incompatível.');const assistants={};for(const [id,a]of Object.entries(data.assistants).slice(0,2000)){if(!a||typeof a!=='object'||id==='__proto__')continue;assistants[id]=cleanAssistant({...a,id});}return {...data,assistants,preferences:portablePreferences(data.preferences)};}
  status(){return {folder:this.store.getMeta('sync.folder')||'',lastSync:this.store.getMeta('sync.last')||null,conflicts:this.conflicts(),portablePreferences:PREFERENCES};}
  conflicts(){return this.store.getMeta('sync.conflicts')||[];}
  async run(mode='pull'){
    this.assertCurrent();const folder=this.folder(),local=this.local(),remote=this.read(),base=this.store.getMeta('sync.base')||{},merged={assistants:{},preferences:{}},conflicts=[];
    for(const group of ['assistants','preferences']){
      const l=local[group]||{},r=remote[group]||{},b=base[group]||{};
      for(const id of new Set([...Object.keys(l),...Object.keys(r),...Object.keys(b)])){
        const lh=digest(l[id]),rh=digest(r[id]),bh=b[id];let value;
        if(lh===rh)value=l[id];
        else if(bh===undefined){if(l[id]!==undefined&&r[id]!==undefined){conflicts.push({id:crypto.randomUUID(),group,key:id,local:l[id],remote:r[id],createdAt:new Date().toISOString()});value=mode==='pull'?l[id]:r[id];}else value=l[id]??r[id];}
        else if(lh===bh)value=r[id];else if(rh===bh)value=l[id];
        else{conflicts.push({id:crypto.randomUUID(),group,key:id,local:l[id]??null,remote:r[id]??null,createdAt:new Date().toISOString()});value=mode==='pull'?l[id]:r[id];}
        if(value!==undefined&&value!==null)merged[group][id]=value;
      }
    }
    this.assertCurrent();
    if(mode==='push'){
      const revision=crypto.randomUUID(),snapshot={format:'lume-sync',version:1,revision,parent:remote.revision,deviceId:this.deviceId,updatedAt:new Date().toISOString(),...merged};
      if(Buffer.byteLength(JSON.stringify(snapshot))>12*1024*1024)throw new Error('Assistentes e preferências ultrapassam o limite de sincronização de 12 MB. Reduza os arquivos permanentes antes de enviar.');
      const versions=path.join(folder,'lume-revisions');fs.mkdirSync(versions,{recursive:true});
      // Immutable snapshots preserve concurrent cloud-folder writes for recovery.
      atomic(path.join(versions,`${Date.now()}-${this.deviceId}-${revision}.json`),JSON.stringify({...snapshot,conflicts},null,2));
      if(this.read().revision!==remote.revision)throw new Error('A pasta mudou durante a sincronização. Suas alterações foram preservadas em lume-revisions; sincronize novamente.');
      atomic(path.join(folder,'lume-sync-v1.json'),JSON.stringify(snapshot,null,2));
    }
    {
      for(const [id,item]of Object.entries(merged.assistants))if(!conflicts.some(c=>c.group==='assistants'&&c.key===id))this.store.assistant(item);
      for(const id of Object.keys(local.assistants))if(!merged.assistants[id]&&!conflicts.some(c=>c.group==='assistants'&&c.key===id))this.store.deleteAssistant(id);
      const patch={...merged.preferences};for(const c of conflicts)if(c.group==='preferences')delete patch[c.key];this.store.settings(patch);
    }
    const nextBase={assistants:{},preferences:{}};
    for(const group of ['assistants','preferences'])for(const id of new Set([...Object.keys(local[group]),...Object.keys(remote[group]),...Object.keys(base[group]||{})])){
      if(conflicts.some(c=>c.group===group&&c.key===id)){if(base[group]?.[id])nextBase[group][id]=base[group][id];}
      else nextBase[group][id]=digest(merged[group][id]);
    }
    const prior=this.conflicts().filter(c=>!conflicts.some(n=>n.group===c.group&&n.key===c.key));
    this.store.setMeta('sync.conflicts',[...prior,...conflicts]);this.store.setMeta('sync.base',nextBase);this.store.setMeta('sync.last',new Date().toISOString());
    return {...this.status(),direction:mode,changed:true};
  }
  resolve({id,choice}){
    this.assertCurrent();const conflicts=this.conflicts(),conflict=conflicts.find(c=>c.id===id);if(!conflict)throw new Error('Conflito não encontrado.');if(!['local','remote','both'].includes(choice))throw new Error('Escolha a versão local, remota ou ambas.');
    const value=conflict[choice];
    if(conflict.group==='assistants'){
      if(choice==='both'){
        if(conflict.local)this.store.assistant(conflict.local);
        if(conflict.remote)this.store.assistant({...conflict.remote,id:crypto.randomUUID(),name:`${conflict.remote.name} (sincronizado)`});
      }else if(value)this.store.assistant(value);else this.store.deleteAssistant(conflict.key);
    }else{
      if(choice==='both')throw new Error('Uma preferência precisa de uma versão ativa. As duas versões permanecem no histórico de revisões.');
      if(value!==null&&value!==undefined)this.store.settings({[conflict.key]:value});
    }
    const base=this.store.getMeta('sync.base')||{assistants:{},preferences:{}};base[conflict.group]||={};base[conflict.group][conflict.key]=digest(conflict.remote);
    this.store.setMeta('sync.base',base);this.store.setMeta('sync.conflicts',conflicts.filter(c=>c.id!==id));return this.status();
  }
}
module.exports={AssistantSync,portablePreferences,cleanAssistant,PREFERENCES};

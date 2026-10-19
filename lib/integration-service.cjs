const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {SecretVault}=require('./secret-vault.cjs');
const {AssistantSync}=require('./assistant-sync.cjs');
const {GoogleConnector}=require('./connectors/google.cjs');
const {ObsidianConnector}=require('./connectors/obsidian.cjs');
const {MCPConnector}=require('./connectors/mcp.cjs');
const {ClientInstaller}=require('./connectors/client-install.cjs');
const {clip,object,remoteUrl}=require('./connectors/common.cjs');
const OBSIDIAN_TOOLS=[
  {name:'notes_search',description:'Pesquisa notas Markdown na pasta Obsidian selecionada.',inputSchema:{type:'object',properties:{query:{type:'string'},limit:{type:'integer',minimum:1,maximum:100}},additionalProperties:false},annotations:{readOnlyHint:true}},
  {name:'note_read',description:'Lê uma nota Markdown pelo caminho relativo retornado pela pesquisa.',inputSchema:{type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false},annotations:{readOnlyHint:true}},
  {name:'note_write',description:'Propõe criar, anexar ou substituir uma nota. Toda gravação exige revisão humana; substituir exige a revisão retornada por note_read.',inputSchema:{type:'object',properties:{path:{type:'string'},text:{type:'string'},mode:{type:'string',enum:['create','append','replace']},revision:{type:'string'}},required:['path','text'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true}}
];
const toolName=(id,name)=>`lume_${crypto.createHash('sha256').update(id+'\0'+name).digest('hex').slice(0,12)}_${name.replace(/[^A-Za-z0-9_-]/g,'_').slice(0,45)}`;

class IntegrationService {
  constructor(options){
    Object.assign(this,{emit:()=>{},openExternal:async()=>{throw new Error('Abertura de navegador não configurada.');},...options});
    this.vault=options.vault||new SecretVault({directory:this.directory,storage:this.storage});
    this.clients=new ClientInstaller({directory:this.directory,vault:this.vault,app:this.app,...(options.clients?{clients:options.clients}:{})});
    this.connectors=new Map();this.pendingApprovals=new Map();this.requests=new Map();this.functions=new Map();this.disposed=false;
    this.operations={
      'connections.list':()=>this.listConnections(),
      'connections.save':args=>this.saveConnection(args),
      'connections.delete':args=>this.deleteConnection(args),
      'connections.connect':args=>this.connect(args),
      'connections.disconnect':args=>this.disconnect(args),
      'google.configure':args=>this.configureGoogle(args),
      'tools.list':args=>this.listTools(args),
      'tools.call':args=>this.executeTool(args),
      'tools.approve':args=>this.approve(args),
      'tools.cancel':args=>this.cancel(args),
      'documents.list':()=>this.documents(),
      'documents.add':args=>this.addDocument(args),
      'documents.remove':args=>this.removeDocument(args),
      'documents.read':args=>this.readDocument(args),
      'obsidian.detect':()=>ObsidianConnector.detect(),
      'obsidian.search':args=>this.executeTool({...args,name:'notes_search',arguments:args.arguments||{query:args.query,limit:args.limit}}),
      'obsidian.read':args=>this.executeTool({...args,name:'note_read',arguments:args.arguments||{path:args.path}}),
      'obsidian.write':args=>this.executeTool({...args,name:'note_write',arguments:args.arguments||{path:args.path,text:args.text,mode:args.mode,revision:args.revision}}),
      'integration.clients':()=>this.clients.status(),
      'integration.status':()=>({clients:this.clients.status(),definition:this.clients.definition(),connections:this.listConnections()}),
      'integration.install':args=>this.installClient(args),
      'integration.remove':args=>this.clients.remove(args),
      'sync.choose':args=>this.chooseSync(args),
      'sync.status':()=>this.sync().status(),
      'sync.push':()=>this.sync().run('push'),
      'sync.pull':()=>this.sync().run('pull'),
      'sync.conflicts':()=>this.sync().conflicts(),
      'sync.resolve':args=>this.sync().resolve(args)
    };
  }
  profile(){const current=this.getProfile?.();return String(typeof current==='string'?current:current?.id||current?.activeId||this.store.profileId||'local');}
  context(){const profileId=this.profile(),service=this;return {profileId,store:this.store.forProfile?.(profileId)||this.store,assertCurrent(){if(service.disposed||service.profile()!==profileId) {const error=new Error('O perfil mudou. Execute a operação novamente na conta desejada.');error.code='PROFILE_CHANGED';throw error;}}};}
  notify(ctx,value){if(this.profile()===ctx.profileId&&!this.disposed)this.emit({...value,profileId:ctx.profileId});}
  connection(id){const connection=this.store.connections().find(c=>c.id===id);if(!connection)throw new Error('Integração não encontrada neste perfil.');return connection;}
  key(profileId,id){return JSON.stringify([profileId,id]);}
  listConnections(){const profileId=this.profile();return this.store.connections().map(c=>{const entry=this.connectors.get(this.key(profileId,c.id));const secret=this.vault.get(profileId,c.id);return {...c,configured:c.kind==='google'?!!secret.googleClient:true,connected:!!entry?.connected,pending:!!entry?.connector?.pending,toolCount:entry?.tools?.length||0,error:entry?.error||null};});}
  async saveConnection(input={}){
    const ctx=this.context(),previous=input.id?this.connection(input.id):null;const kind=input.kind||input.type||previous?.kind||'mcp';if(!['mcp','notion','google','obsidian'].includes(kind))throw new Error('Tipo de integração inválido.');
    const id=previous?.id||crypto.randomUUID(),name=clip(input.name||previous?.name||({notion:'Notion',google:'Google',obsidian:'Obsidian'}[kind])||'Servidor MCP',120).trim();if(!name)throw new Error('Dê um nome à integração.');
    const value={id,name,kind,enabled:input.enabled!==false,...(previous?{createdAt:previous.createdAt}:{createdAt:new Date().toISOString()})};
    if(kind==='mcp'||kind==='notion'){
      value.transport=kind==='notion'?'http':input.transport||previous?.transport||'http';if(!['stdio','http','sse'].includes(value.transport))throw new Error('Transporte MCP inválido.');
      value.auth=kind==='notion'?'oauth':input.auth||previous?.auth||'oauth';if(!['oauth','none','bearer'].includes(value.auth))throw new Error('Autenticação MCP inválida.');
      if(value.transport==='stdio'){
        value.command=clip(input.command||previous?.command,2000).trim();if(!value.command||/[\r\n\0]/.test(value.command))throw new Error('Informe um executável válido para o servidor MCP.');
        value.args=(Array.isArray(input.args)?input.args:previous?.args||[]).slice(0,100).map(x=>clip(x,8000));value.cwd=clip(input.cwd??previous?.cwd,2000);value.electronNode=!!(input.electronNode??previous?.electronNode);
      }else value.url=remoteUrl(kind==='notion'?'https://mcp.notion.com/mcp':input.url||previous?.url).href;
    }
    if(kind==='obsidian'){
      value.vaultPath=clip(input.vaultPath||previous?.vaultPath,4000);value.restUrl=clip(input.restUrl??previous?.restUrl,2000);
      if(!value.vaultPath&&!value.restUrl&&this.chooseDirectory){const folder=await this.chooseDirectory({title:'Escolher pasta Obsidian'});ctx.assertCurrent();value.vaultPath=dialogPath(folder);}
      if(value.restUrl){const url=remoteUrl(value.restUrl);if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('Obsidian Local REST deve estar no computador local.');value.restUrl=url.href;}
      else if(!value.vaultPath||!fs.existsSync(value.vaultPath)||!fs.statSync(value.vaultPath).isDirectory())throw new Error('Escolha a pasta de notas Obsidian.');
    }
    ctx.assertCurrent();const secrets={...object(input.secrets)};
    for(const key of ['env','headers','bearerToken','apiKey'])if(input[key]!==undefined)secrets[key]=input[key];
    const safeSecrets={};for(const key of ['env','headers'])if(secrets[key]!==undefined){const values=object(secrets[key]);safeSecrets[key]=Object.fromEntries(Object.entries(values).slice(0,100).filter(([k,v])=>/^[\w-]{1,100}$/.test(k)&&typeof v==='string'&&v.length<=16000));}
    for(const key of ['bearerToken','apiKey'])if(secrets[key]!==undefined)safeSecrets[key]=clip(secrets[key],16000);
    if(Object.keys(safeSecrets).length)this.vault.set(ctx.profileId,id,safeSecrets);
    const old=this.connectors.get(this.key(ctx.profileId,id));if(old)await old.connector.disconnect?.();ctx.assertCurrent();this.connectors.delete(this.key(ctx.profileId,id));
    ctx.store.saveConnection(value);this.notify(ctx,{type:'connections-changed'});return value;
  }
  async deleteConnection({id,connectionId}={}){const ctx=this.context(),connection=this.connection(id||connectionId);await this.disconnect({connectionId:connection.id});ctx.assertCurrent();this.vault.delete(ctx.profileId,connection.id);this.store.deleteConnection(connection.id);for(const doc of this.store.documents().filter(x=>x.connectionId===connection.id))this.store.deleteDocument(doc.id);this.notify(ctx,{type:'connections-changed'});return {deleted:true};}
  entry(id,ctx=this.context()){
    const connection=this.connection(id),key=this.key(ctx.profileId,id);let entry=this.connectors.get(key);if(entry)return entry;
    const options={connection,vault:this.vault,profileId:ctx.profileId,openExternal:this.openExternal,assertCurrent:ctx.assertCurrent,fetchImpl:this.fetchImpl,onChange:change=>{if(this.profile()!==ctx.profileId)return;entry.connected=!!change.connected;entry.error=change.error||null;if(entry.connector.tools)entry.tools=entry.connector.tools();this.notify(ctx,{type:'connection-status',connectionId:id,...change});}};
    let connector;
    if(connection.kind==='google')connector=new GoogleConnector(options);
    else if(connection.kind==='obsidian')connector=new ObsidianConnector({...options,secrets:this.vault.get(ctx.profileId,id)});
    else connector=new MCPConnector({...options,sdk:this.sdk});
    entry={connector,connection,connected:connection.kind==='google'&&!!this.vault.get(ctx.profileId,id).googleTokens?.access_token,tools:connection.kind==='google'?connector.tools():connection.kind==='obsidian'?OBSIDIAN_TOOLS:[]};this.connectors.set(key,entry);return entry;
  }
  async connect({id,connectionId}={}){
    const ctx=this.context(),entry=this.entry(id||connectionId,ctx);let result;
    if(entry.connection.kind==='obsidian'){if(!entry.connection.restUrl)entry.connector.root();entry.connected=true;result={connected:true};}
    else result=await entry.connector.connect();ctx.assertCurrent();entry.connected=!!result.connected;entry.tools=entry.connector.tools?.()||entry.tools;this.notify(ctx,{type:'connections-changed'});return {...result,connectionId:entry.connection.id};
  }
  async disconnect({id,connectionId,forget=false}={}){
    const ctx=this.context(),connection=this.connection(id||connectionId),key=this.key(ctx.profileId,connection.id),entry=this.connectors.get(key);await entry?.connector.disconnect?.();ctx.assertCurrent();this.connectors.delete(key);
    for(const [approvalId,pending]of this.pendingApprovals)if(pending.profileId===ctx.profileId&&pending.connectionId===connection.id)this.pendingApprovals.delete(approvalId);
    for(const request of this.requests.values())if(request.profileId===ctx.profileId&&request.connectionId===connection.id)request.controller.abort();
    if(forget){const existing=this.vault.get(ctx.profileId,connection.id);this.vault.set(ctx.profileId,connection.id,{...existing,tokens:null,googleTokens:null,bearerToken:null,apiKey:null});}
    this.notify(ctx,{type:'connection-status',connectionId:connection.id,connected:false});return {disconnected:true};
  }
  async configureGoogle(args={}){
    const ctx=this.context();let connectionId=args.connectionId||args.id;if(!connectionId){const connection=await this.saveConnection({kind:'google',name:'Google'});connectionId=connection.id;}
    const entry=this.entry(connectionId,ctx);if(entry.connection.kind!=='google')throw new Error('Selecione uma integração Google.');let filename=args.filename;
    if(!args.json&&!filename&&this.chooseFile)filename=dialogPath(await this.chooseFile({title:'Importar cliente OAuth desktop Google',filters:[{name:'JSON',extensions:['json']}]}));ctx.assertCurrent();if(!args.json&&!filename)return {cancelled:true};
    const result=entry.connector.configure({json:args.json,filename});entry.connected=false;this.notify(ctx,{type:'connections-changed'});return {...result,connectionId};
  }
  async listTools({connectionId,refresh=false}={}){
    const ctx=this.context(),connections=connectionId?[this.connection(connectionId)]:this.store.connections().filter(c=>c.enabled!==false),results=[];
    for(const connection of connections){const entry=this.entry(connection.id,ctx);if(refresh&&entry.connected&&entry.connector.refreshTools)entry.tools=await entry.connector.refreshTools();ctx.assertCurrent();for(const tool of entry.tools)results.push({...tool,connectionId:connection.id,connectionName:connection.name,functionName:toolName(connection.id,tool.name),connected:entry.connected});}return results;
  }
  async toolDefinitions(selectedConnectionIds){
    const ctx=this.context(),selected=Array.isArray(selectedConnectionIds)?new Set(selectedConnectionIds):null;const tools=await this.listTools({});ctx.assertCurrent();const result=[];
    for(const tool of tools){if(!tool.connected||selected&&!selected.has(tool.connectionId))continue;this.functions.set(tool.functionName,{connectionId:tool.connectionId,name:tool.name,profileId:ctx.profileId});result.push({type:'function',name:tool.functionName,description:clip(`[${tool.connectionName}] ${tool.description}${tool.annotations?.readOnlyHint===true?'':' Esta operação exige aprovação humana antes da execução.'}`,4000),parameters:tool.inputSchema,strict:false});}return result;
  }
  async executeTool(input={}){
    const ctx=this.context();let {connectionId,name}=input;
    if(!connectionId){const mapped=this.functions.get(name);if(!mapped||mapped.profileId!==ctx.profileId)throw new Error('Ferramenta não encontrada no perfil ativo.');({connectionId,name}=mapped);}
    const entry=this.entry(connectionId,ctx),tool=entry.tools.find(t=>t.name===name);if(!tool)throw new Error('Ferramenta não encontrada nesta integração.');
    if(!entry.connected)throw new Error('Conecte a integração antes de usar suas ferramentas.');const args=object(input.arguments);
    if(Buffer.byteLength(JSON.stringify(args))>1024*1024)throw new Error('Os argumentos da ferramenta ultrapassam 1 MB.');
    if(tool.annotations?.readOnlyHint!==true){
      const approved=input.approvalId&&this.pendingApprovals.get(input.approvalId);
      if(!approved||!approved.approved||approved.profileId!==ctx.profileId||approved.connectionId!==connectionId||approved.name!==name||JSON.stringify(approved.arguments)!==JSON.stringify(args)||approved.expiresAt<Date.now()){
        const approvalId=crypto.randomUUID(),pending={approvalId,profileId:ctx.profileId,connectionId,name,arguments:structuredClone(args),sessionId:clip(input.sessionId,200),requestId:input.requestId||crypto.randomUUID(),expiresAt:Date.now()+10*60*1000,approved:false};
        for(const [key,value]of this.pendingApprovals)if(value.expiresAt<Date.now())this.pendingApprovals.delete(key);
        if(this.pendingApprovals.size>=100)throw new Error('Revise ou cancele as propostas de ferramentas pendentes antes de continuar.');
        this.pendingApprovals.set(approvalId,pending);this.notify(ctx,{type:'tool-approval',...pending,connectionName:entry.connection.name,description:tool.description});return {pendingApproval:true,approvalId,connectionId,name,profileId:ctx.profileId,sessionId:pending.sessionId,requestId:pending.requestId};
      }
      this.pendingApprovals.delete(input.approvalId);
    }
    const requestId=input.requestId||crypto.randomUUID(),controller=new AbortController(),signal=input.signal?AbortSignal.any([input.signal,controller.signal]):controller.signal;
    this.requests.set(requestId,{controller,profileId:ctx.profileId,connectionId});const event={connectionId,name,sessionId:input.sessionId,requestId};this.notify(ctx,{type:'tool-progress',...event,status:'running'});
    try{
      signal.throwIfAborted();let value;if(entry.connection.kind==='obsidian')value=await entry.connector[{notes_search:'search',note_read:'read',note_write:'write'}[name]](args);else value=await entry.connector.execute(name,args,signal);ctx.assertCurrent();
      const documents=Array.isArray(value.documents)?value.documents:extractReferences(value);
      for(const doc of documents.slice(0,100))this.rememberDocument(ctx,{...doc,remoteId:doc.id||doc.path,connectionId});
      if(name==='document_read'||name==='note_read')this.rememberDocument(ctx,{...value,remoteId:args.id||args.path,connectionId});
      const result={content:Array.isArray(value.content)?value.content:[{type:'text',text:clip(JSON.stringify(value),200000)}],...(value.structuredContent!==undefined?{structuredContent:value.structuredContent}:{}),documents,source:{connectionId,name:entry.connection.name},isError:!!value.isError,data:value,profileId:ctx.profileId,sessionId:input.sessionId||'',requestId};
      this.notify(ctx,{type:'tool-result',...event,status:value.isError?'error':'completed',result});return result;
    }catch(error){this.notify(ctx,{type:'tool-result',...event,status:'error',error:clip(error.message,2000)});throw error;}
    finally{this.requests.delete(requestId);}
  }
  async approve({approvalId,approved=true}={}){
    const ctx=this.context(),pending=this.pendingApprovals.get(approvalId);if(!pending||pending.profileId!==ctx.profileId||pending.expiresAt<Date.now())throw new Error('A proposta expirou ou pertence a outro perfil.');
    if(!approved){this.pendingApprovals.delete(approvalId);this.notify(ctx,{type:'tool-result',connectionId:pending.connectionId,requestId:pending.requestId,sessionId:pending.sessionId,status:'cancelled'});return {cancelled:true};}
    pending.approved=true;return this.executeTool({...pending,approvalId});
  }
  cancel({requestId,approvalId}={}){
    const ctx=this.context(),request=this.requests.get(requestId);if(request&&request.profileId===ctx.profileId)request.controller.abort();const pending=this.pendingApprovals.get(approvalId);if(pending?.profileId===ctx.profileId)this.pendingApprovals.delete(approvalId);return {cancelled:true};
  }
  documents(){return this.store.documents();}
  rememberDocument(ctx,input){
    ctx.assertCurrent();const remoteId=clip(input.remoteId||input.path,2000);if(!remoteId)return null;
    const previous=this.store.documents().find(x=>x.connectionId===input.connectionId&&x.remoteId===remoteId);
    const candidateUrl=clip(input.url||input.webViewLink,2000);const value={id:previous?.id||crypto.randomUUID(),connectionId:input.connectionId,remoteId,name:clip(input.name||input.title||remoteId,300),source:clip(input.source||'mcp',100),mimeType:clip(input.mimeType,150),url:/^https?:\/\//i.test(candidateUrl)?candidateUrl:'',resourceUri:clip(input.resourceUri||previous?.resourceUri,2000),updatedAt:new Date().toISOString(),selected:input.selected??previous?.selected??false};
    ctx.store.saveDocument(value);const docs=ctx.store.documents();if(docs.length>200)for(const stale of docs.filter(x=>!x.selected).sort((a,b)=>a.updatedAt.localeCompare(b.updatedAt)).slice(0,docs.length-200))ctx.store.deleteDocument(stale.id);return value;
  }
  addDocument(input){const ctx=this.context();this.connection(input.connectionId);return this.rememberDocument(ctx,{...input,remoteId:input.remoteId||input.id||input.path,selected:input.selected!==false});}
  removeDocument({id}){this.store.deleteDocument(id);return {removed:true};}
  async readDocument({id,sessionId,requestId}={}){const ctx=this.context(),doc=ctx.store.documents().find(d=>d.id===id);if(!doc)throw new Error('Documento não encontrado neste perfil.');const connection=this.connection(doc.connectionId);if(connection.kind==='google')return this.executeTool({connectionId:connection.id,name:'document_read',arguments:{id:doc.remoteId},sessionId,requestId});if(connection.kind==='obsidian')return this.executeTool({connectionId:connection.id,name:'note_read',arguments:{path:doc.remoteId},sessionId,requestId});const entry=this.entry(connection.id,ctx);if(!entry.connected)throw new Error('Conecte o servidor MCP antes de ler recursos.');if(!doc.resourceUri)throw new Error('Leia este documento pela ferramenta de consulta do servidor MCP correspondente.');const result=await entry.connector.readResource(doc.resourceUri);ctx.assertCurrent();return {content:(result.contents||[]).filter(c=>typeof c.text==='string').map(c=>({type:'text',text:clip(c.text,128000)})),source:{connectionId:connection.id,name:connection.name},profileId:ctx.profileId,sessionId,requestId};}
  sync(){const ctx=this.context();return new AssistantSync(ctx);}
  async chooseSync(args={}){const ctx=this.context();const folder=args.folder||dialogPath(await this.chooseDirectory?.({title:'Escolher pasta de sincronização'}));ctx.assertCurrent();if(!folder)return {cancelled:true};return this.sync().choose(folder);}
  async installClient(args={}){let input={...args};if(input.clientId==='custom'&&!input.configFile)input.configFile=dialogPath(await this.chooseFile?.({title:'Selecionar configuração MCP do cliente',filters:[{name:'JSON',extensions:['json']}]}));if(input.clientId==='custom'&&!input.configFile)return {cancelled:true};return this.clients.install(input);}
  async profileChanged(){for(const [key,entry]of this.connectors){await entry.connector.disconnect?.();this.connectors.delete(key);}for(const request of this.requests.values())request.controller.abort();this.requests.clear();this.pendingApprovals.clear();this.functions.clear();}
  async dispose(){this.disposed=true;await this.profileChanged();}
}
function dialogPath(value){if(typeof value==='string')return value;if(Array.isArray(value))return value[0]||'';if(value?.canceled)return '';return value?.filePaths?.[0]||value?.path||'';}
function extractReferences(value){
  const refs=[];const visit=(item,depth=0)=>{
    if(!item||typeof item!=='object'||depth>8||refs.length>=100)return;
    if(Array.isArray(item)){for(const child of item.slice(0,100))visit(child,depth+1);return;}
    if(item.type==='resource_link'&&typeof item.uri==='string')refs.push({id:item.uri,resourceUri:item.uri,name:clip(item.name||item.title||item.uri,300),url:/^https?:/.test(item.uri)?item.uri:'',mimeType:item.mimeType,source:'mcp'});
    else if(typeof item.url==='string'&&/^https:\/\//.test(item.url)&&(typeof item.id==='string'||typeof item.title==='string'||typeof item.name==='string'))refs.push({id:clip(item.id||item.url,2000),name:clip(item.name||item.title||item.url,300),url:clip(item.url,2000),source:'mcp'});
    for(const [key,child]of Object.entries(item)){
      if(key==='text'&&typeof child==='string'&&child.length<=1024*1024){try{visit(JSON.parse(child),depth+1);}catch{}}
      else if(child&&typeof child==='object')visit(child,depth+1);
    }
  };visit(value);return refs;
}
module.exports={IntegrationService,toolName,OBSIDIAN_TOOLS};

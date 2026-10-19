const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const readline=require('node:readline');
const directory=process.env.LUME_DATA_DIR||path.join(process.env.APPDATA||path.join(process.env.HOME||process.cwd(),'.config'),'Lume');
const fields={assistantId:{type:'string'},prompt:{type:'string'},goal:{type:'string'},context:{type:'string'},source:{type:'string'},mode:{type:'string',enum:['conversation','meeting','summary','code-review','study','followup']},files:{type:'array',maxItems:8,items:{type:'object',properties:{name:{type:'string'},text:{type:'string'}},required:['name','text'],additionalProperties:false}}};
const tools=[
  {name:'app_status',description:'Verifica a integração do Lume neste computador.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true}},
  {name:'list_assistants',description:'Lista nomes e identificadores dos assistentes do Lume.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true}},
  {name:'prepare_session',description:'Prepara sessão, objetivo, contexto, arquivos textuais e modo especializado para revisão no Lume. Nunca envia automaticamente.',inputSchema:{type:'object',properties:fields,additionalProperties:false}},
  {name:'prepare_summary',description:'Prepara um pedido de resumo para revisão no Lume.',inputSchema:{type:'object',properties:fields,additionalProperties:false}},
  {name:'prepare_code_review',description:'Prepara uma revisão de código com arquivos textuais para revisão no Lume.',inputSchema:{type:'object',properties:fields,additionalProperties:false}},
  {name:'prepare_followup',description:'Prepara próximos passos a partir do contexto, para revisão no Lume.',inputSchema:{type:'object',properties:fields,additionalProperties:false}},
  {name:'propose_assistant',description:'Propõe um assistente com instruções separadas de conversa, insights, perguntas, resumo e ferramentas. O usuário revisa antes de salvar.',inputSchema:{type:'object',properties:{name:{type:'string'},instructions:{type:'string'},knowledge:{type:'string'},description:{type:'string'},insightInstructions:{type:'string'},questionInstructions:{type:'string'},summaryInstructions:{type:'string'},toolInstructions:{type:'string'},prompt:{type:'string'}},required:['name','instructions'],additionalProperties:false}}
];
const clip=(v,n)=>typeof v==='string'?v.slice(0,n):'';
function readBridge(){const file=path.join(directory,'integrations','bridge.json');if(!fs.existsSync(file))throw new Error('Abra o Lume pelo menos uma vez antes de usar esta integração.');if(fs.statSync(file).size>1024*1024)throw new Error('Registro de integração inválido.');return JSON.parse(fs.readFileSync(file,'utf8'));}
function payloadFor(name,args={}){
  const payload={version:2,assistantId:clip(args.assistantId,200),prompt:clip(args.prompt,16000),goal:clip(args.goal,16000),context:clip(args.context,128000),source:clip(args.source,120),mode:fields.mode.enum.includes(args.mode)?args.mode:'conversation'};
  const modes={prepare_summary:['summary','Resuma o contexto, distinguindo decisões, dúvidas e próximos passos.'],prepare_code_review:['code-review','Revise os arquivos fornecidos. Identifique problemas concretos e cite os arquivos relevantes.'],prepare_followup:['followup','Proponha próximos passos com responsáveis e prazos somente quando constarem no contexto.']};
  if(modes[name]){payload.mode=modes[name][0];payload.prompt||=modes[name][1];}
  if(Array.isArray(args.files))payload.files=args.files.slice(0,8).filter(f=>f&&typeof f.name==='string'&&typeof f.text==='string').map(f=>({name:clip(f.name,200).replace(/[\\/\0]/g,'_'),text:clip(f.text,128000)}));
  if(name==='propose_assistant'){
    if(!args.name?.trim()||!args.instructions?.trim())throw new Error('Nome e instruções são obrigatórios.');
    payload.newAssistant={name:clip(args.name,120),instructions:clip(args.instructions,32000),knowledge:clip(args.knowledge,128000),description:clip(args.description,400)};
    for(const key of ['insightInstructions','questionInstructions','summaryInstructions','toolInstructions'])payload.newAssistant[key]=clip(args[key],32000);
  }
  if(Buffer.byteLength(JSON.stringify(payload))>2*1024*1024)throw new Error('O pedido externo ultrapassa 2 MB.');return payload;
}
async function execute(name,args){
  const bridge=readBridge();
  if(name==='app_status')return {installed:fs.existsSync(bridge.executable),reviewRequired:true,handoffVersions:bridge.handoffVersions||[1]};
  if(name==='list_assistants')return bridge.assistants;
  if(!tools.some(t=>t.name===name))throw new Error('Ferramenta não encontrada.');
  const id=randomUUID(),payload=payloadFor(name,args);fs.mkdirSync(bridge.handoffDir,{recursive:true});
  const filename=path.join(bridge.handoffDir,`${id}.json`);fs.writeFileSync(filename,JSON.stringify(payload),{mode:0o600,flag:'wx'});
  const url=`lume://session/start?handoff=${id}`,env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(bridge.executable,bridge.packaged?[url]:[bridge.appRoot,url],{env,detached:true,stdio:'ignore',windowsHide:true});
  try{await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});}catch(error){try{fs.unlinkSync(filename);}catch{}throw error;}
  child.unref();return {prepared:true,reviewRequired:true,message:'O pedido foi aberto no Lume para revisão. Nenhuma mensagem foi enviada automaticamente.'};
}
function reply(value){process.stdout.write(JSON.stringify(value)+'\n');}
async function handle(request){
  if(!request||typeof request!=='object'||Array.isArray(request))return reply({jsonrpc:'2.0',id:null,error:{code:-32600,message:'Pedido inválido.'}});
  if(request.method==='notifications/initialized'||request.id===undefined)return;
  const {id,method,params={}}=request;
  try{
    if(method==='initialize')return reply({jsonrpc:'2.0',id,result:{protocolVersion:['2024-11-05','2025-03-26','2025-06-18','2026-07-28'].includes(params.protocolVersion)?params.protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'lume',version:'0.2.0'}}});
    if(method==='ping')return reply({jsonrpc:'2.0',id,result:{}});
    if(method==='tools/list')return reply({jsonrpc:'2.0',id,result:{tools}});
    if(method==='tools/call'){
      try{const result=await execute(params.name,params.arguments||{});return reply({jsonrpc:'2.0',id,result:{content:[{type:'text',text:JSON.stringify(result)}]}});}
      catch(e){return reply({jsonrpc:'2.0',id,result:{isError:true,content:[{type:'text',text:e.message}]}});}
    }
    reply({jsonrpc:'2.0',id,error:{code:-32601,message:'Método não encontrado.'}});
  }catch{reply({jsonrpc:'2.0',id,error:{code:-32603,message:'A operação não foi concluída.'}});}
}
function start(){const rl=readline.createInterface({input:process.stdin,crlfDelay:Infinity});rl.on('line',line=>{if(Buffer.byteLength(line)>2*1024*1024){reply({jsonrpc:'2.0',id:null,error:{code:-32600,message:'Pedido muito grande.'}});return;}try{handle(JSON.parse(line));}catch{reply({jsonrpc:'2.0',id:null,error:{code:-32700,message:'JSON inválido.'}});}});}
if(require.main===module)start();
module.exports={tools,payloadFor};

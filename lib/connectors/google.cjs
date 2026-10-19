const fs=require('node:fs');
const crypto=require('node:crypto');
const {clip,loopback,jsonResponse,textResponse}=require('./common.cjs');
const SCOPES=['https://www.googleapis.com/auth/calendar.readonly','https://www.googleapis.com/auth/drive.readonly','https://www.googleapis.com/auth/documents.readonly','https://www.googleapis.com/auth/spreadsheets.readonly'];
const TOKEN='https://oauth2.googleapis.com/token';
const TOOL_SCHEMAS=[
  ['calendar_list','Lista os calendários autorizados.',{pageToken:{type:'string'}}],
  ['calendar_events','Consulta eventos de um calendário em um intervalo.',{calendarId:{type:'string'},timeMin:{type:'string'},timeMax:{type:'string'},query:{type:'string'},pageToken:{type:'string'}},['calendarId','timeMin']],
  ['drive_search','Pesquisa documentos no Google Drive. Retorna referências e próxima página.',{query:{type:'string'},pageToken:{type:'string'},mimeType:{type:'string'}}],
  ['document_read','Lê um Google Doc, planilha ou arquivo textual pelo ID.',{id:{type:'string'},range:{type:'string'}},['id']],
  ['spreadsheet_info','Lista abas e propriedades de uma planilha.',{id:{type:'string'}},['id']]
].map(([name,description,properties,required=[]])=>({name,description,inputSchema:{type:'object',properties,required,additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false}}));

class GoogleConnector {
  constructor({connection,vault,profileId,openExternal,assertCurrent=()=>{},onChange=()=>{},fetchImpl=fetch}){Object.assign(this,{connection,vault,profileId,openExternal,assertCurrent,onChange,fetch:fetchImpl});this.refreshing=null;this.pending=null;}
  secret(){return this.vault.get(this.profileId,this.connection.id);}
  configure({json,filename}){
    this.assertCurrent();if(filename){if(fs.statSync(filename).size>256000)throw new Error('O arquivo OAuth é muito grande.');json=fs.readFileSync(filename,'utf8');}
    let data;try{data=typeof json==='string'?JSON.parse(json):json;}catch{throw new Error('Arquivo OAuth inválido.');}
    const client=data?.installed;
    if(!client?.client_id||!client.client_id.endsWith('.apps.googleusercontent.com')||typeof client.client_secret!=='string')throw new Error('Importe o JSON de um cliente OAuth do tipo Aplicativo para computador, criado para o Lume.');
    this.vault.set(this.profileId,this.connection.id,{googleClient:{client_id:client.client_id,client_secret:client.client_secret},googleTokens:null});
    return {configured:true,scopes:SCOPES,requiresGoogleProject:true};
  }
  async connect(){
    this.assertCurrent();const credentials=this.secret();if(!credentials.googleClient)throw new Error('Importe primeiro o JSON OAuth desktop do seu projeto Google.');
    if(credentials.googleTokens?.access_token){await this.access();this.onChange({connected:true});return {connected:true};}
    this.disconnect();const verifier=crypto.randomBytes(64).toString('base64url');
    const listener=await loopback({onCode:async code=>{
      this.assertCurrent();const tokens=await this.exchange({grant_type:'authorization_code',code,redirect_uri:listener.redirectUri,code_verifier:verifier});this.assertCurrent();
      if(!tokens.access_token)throw new Error('O Google não retornou uma credencial.');
      this.vault.set(this.profileId,this.connection.id,{googleTokens:{...tokens,expiresAt:Date.now()+Number(tokens.expires_in||3600)*1000}});this.pending=null;this.onChange({connected:true});
    },onError:error=>{this.pending=null;this.onChange({connected:false,error:error.message});}});
    this.pending=listener;const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search=new URLSearchParams({client_id:credentials.googleClient.client_id,redirect_uri:listener.redirectUri,response_type:'code',scope:SCOPES.join(' '),state:listener.state,code_challenge_method:'S256',code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url'),access_type:'offline',prompt:'consent',include_granted_scopes:'true'}).toString();
    try{await this.openExternal(url.href);return {pending:true};}catch(error){listener.close();this.pending=null;throw error;}
  }
  disconnect(){this.pending?.close();this.pending=null;}
  async exchange(fields){
    const client=this.secret().googleClient;if(!client)throw new Error('Configure o cliente OAuth desktop.');
    const response=await this.fetch(TOKEN,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...fields,...client}),signal:AbortSignal.timeout(25000)});
    if(!response.ok){const error=new Error('Não foi possível autorizar o Google. Verifique o cliente desktop, as APIs habilitadas e o usuário de teste no projeto.');error.status=response.status;throw error;}return jsonResponse(response);
  }
  async access(){
    this.assertCurrent();const secret=this.secret(),tokens=secret.googleTokens;if(!tokens?.access_token)throw new Error('Conecte a conta Google.');
    if(tokens.expiresAt>Date.now()+60000)return tokens.access_token;
    if(!tokens.refresh_token)throw new Error('A autorização do Google expirou. Reconecte a conta.');
    if(this.refreshing)return this.refreshing;
    this.refreshing=(async()=>{const next=await this.exchange({grant_type:'refresh_token',refresh_token:tokens.refresh_token});this.assertCurrent();if(!next.access_token)throw new Error('A renovação do Google não retornou uma credencial.');this.vault.set(this.profileId,this.connection.id,{googleTokens:{...tokens,...next,expiresAt:Date.now()+Number(next.expires_in||3600)*1000}});return next.access_token;})();
    try{return await this.refreshing;}finally{this.refreshing=null;}
  }
  async request(host,route,params={},signal){
    if(!['www.googleapis.com','docs.googleapis.com','sheets.googleapis.com'].includes(host))throw new Error('Endpoint Google inválido.');
    const url=new URL(`https://${host}${route}`);for(const [k,v]of Object.entries(params))if(v!==undefined&&v!=='')url.searchParams.set(k,String(v));
    const token=await this.access(),response=await this.fetch(url,{headers:{Authorization:`Bearer ${token}`},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(25000)]):AbortSignal.timeout(25000)});this.assertCurrent();
    return jsonResponse(response);
  }
  async execute(name,args={},signal){
    switch(name){
      case 'calendar_list':{const data=await this.request('www.googleapis.com','/calendar/v3/users/me/calendarList',{maxResults:100,pageToken:args.pageToken},signal);return {calendars:(data.items||[]).map(x=>({id:x.id,name:x.summary,timeZone:x.timeZone,primary:!!x.primary})),nextPageToken:data.nextPageToken||null};}
      case 'calendar_events':{
        const calendarId=clip(args.calendarId,500)||'primary';if(!args.timeMin||!Number.isFinite(Date.parse(args.timeMin)))throw new Error('Informe timeMin em formato de data e hora ISO.');if(args.timeMax&&!Number.isFinite(Date.parse(args.timeMax)))throw new Error('timeMax inválido.');
        const data=await this.request('www.googleapis.com',`/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,{timeMin:args.timeMin,timeMax:args.timeMax,singleEvents:true,orderBy:'startTime',maxResults:100,q:clip(args.query,200),pageToken:args.pageToken},signal);
        return {events:(data.items||[]).map(x=>({id:x.id,title:x.summary,description:clip(x.description,12000),start:x.start,end:x.end,location:x.location,url:x.htmlLink,attendees:(x.attendees||[]).slice(0,50).map(a=>({name:a.displayName,email:a.email,status:a.responseStatus}))})),nextPageToken:data.nextPageToken||null};
      }
      case 'drive_search':{
        const quote=value=>value.replaceAll('\\','\\\\').replaceAll("'","\\'");let q='trashed = false';if(args.query)q+=` and (name contains '${quote(clip(args.query,200))}' or fullText contains '${quote(clip(args.query,200))}')`;if(args.mimeType)q+=` and mimeType = '${quote(clip(args.mimeType,150))}'`;
        const data=await this.request('www.googleapis.com','/drive/v3/files',{q,pageSize:50,pageToken:args.pageToken,fields:'nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink,size)',orderBy:'modifiedTime desc'},signal);return {documents:(data.files||[]).map(x=>({id:x.id,name:x.name,mimeType:x.mimeType,url:x.webViewLink,updatedAt:x.modifiedTime,size:x.size,source:'google'})),nextPageToken:data.nextPageToken||null};
      }
      case 'spreadsheet_info':{const id=validId(args.id),data=await this.request('sheets.googleapis.com',`/v4/spreadsheets/${id}`,{fields:'spreadsheetId,spreadsheetUrl,properties.title,sheets.properties'},signal);return data;}
      case 'document_read':return this.readDocument(args,signal);
      default:throw new Error('Ferramenta Google não encontrada.');
    }
  }
  async readDocument(args,signal){
    const id=validId(args.id),meta=await this.request('www.googleapis.com',`/drive/v3/files/${id}`,{fields:'id,name,mimeType,webViewLink,size'},signal);let text='',detail;
    if(meta.mimeType==='application/vnd.google-apps.document'){
      const data=await this.request('docs.googleapis.com',`/v1/documents/${id}`,{includeTabsContent:true},signal);
      const chunks=[];function visit(value){if(!value||typeof value!=='object')return;if(value.textRun?.content)chunks.push(value.textRun.content);for(const [key,child]of Object.entries(value)){if(key==='textRun')continue;if(Array.isArray(child))child.forEach(visit);else if(child&&typeof child==='object')visit(child);}}visit(data.tabs?.length?data.tabs:data.body);text=chunks.join('');
    }else if(meta.mimeType==='application/vnd.google-apps.spreadsheet'){
      const range=clip(args.range,200)||'A1:Z200';const data=await this.request('sheets.googleapis.com',`/v4/spreadsheets/${id}/values/${encodeURIComponent(range)}`,{valueRenderOption:'FORMATTED_VALUE'},signal);detail={range:data.range,values:data.values||[]};text=(data.values||[]).map(row=>row.map(v=>String(v)).join('\t')).join('\n');
    }else if(/^text\//.test(meta.mimeType)||['application/json','application/javascript','application/xml'].includes(meta.mimeType)){
      if(Number(meta.size)>1024*1024)throw new Error('O arquivo textual ultrapassa 1 MB.');const token=await this.access();const response=await this.fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`,{headers:{Authorization:`Bearer ${token}`},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(25000)]):AbortSignal.timeout(25000)});text=await textResponse(response,{max:1024*1024});
    }else throw new Error('Este tipo de arquivo não fornece texto diretamente. Selecione um Google Doc, planilha ou arquivo textual.');
    this.assertCurrent();return {...meta,source:'google',text:clip(text,128000),truncated:text.length>128000,...detail};
  }
  tools(){return TOOL_SCHEMAS;}
}
function validId(id){if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,256}$/.test(id))throw new Error('Identificador Google inválido.');return id;}
module.exports={GoogleConnector,SCOPES,TOOL_SCHEMAS};

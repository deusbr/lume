const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const crypto=require('node:crypto');
const {atomicWrite}=require('./store.cjs');
const ISSUER='https://auth.openai.com';
const RESOURCE='https://api.openai.com/v1';
const SCOPES='openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const PLAN_SCOPE='chatgpt.tokens.use.direct';
const safeEqual=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
class ChatGPTAuth {
  constructor({directory,storage,openExternal,onChange=()=>{},fetchImpl=fetch,verifyToken}) {
    Object.assign(this,{directory,storage,openExternal,onChange,fetch:fetchImpl,verifyToken});
    this.file=path.join(directory,'chatgpt-credentials.bin'); this.hostFile=path.join(directory,'chatgpt-host.json');
    this.vault={profiles:[],activeId:null}; this.pending=null; this.refreshing=new Map();
    fs.mkdirSync(directory,{recursive:true});
    if(fs.existsSync(this.hostFile))this.hostId=JSON.parse(fs.readFileSync(this.hostFile,'utf8')).id;
    else {this.hostId=`urn:uuid:${crypto.randomUUID()}`;atomicWrite(this.hostFile,JSON.stringify({id:this.hostId}));}
    if(fs.existsSync(this.file)){try{if(!storage.isEncryptionAvailable())throw new Error();this.vault=JSON.parse(storage.decryptString(fs.readFileSync(this.file)));}catch{this.storageError='Não foi possível abrir a conexão protegida. Entre novamente; os dados anteriores foram preservados.';}}
  }
  persist(){if(!this.storage.isEncryptionAvailable())throw new Error('O armazenamento seguro do Windows não está disponível. O login não será salvo sem criptografia.');atomicWrite(this.file,this.storage.encryptString(JSON.stringify(this.vault)));}
  active(){return this.vault.profiles.find(p=>p.id===this.vault.activeId)||null;}
  status(){const active=this.active();return {pending:!!this.pending,activeId:this.vault.activeId,error:this.storageError||null,profiles:this.vault.profiles.map(p=>({id:p.id,label:p.label,email:p.email,connected:!!p.accessToken,planEnabled:p.scopes?.includes(PLAN_SCOPE)||false})),connected:!!active?.accessToken,planEnabled:active?.scopes?.includes(PLAN_SCOPE)||false,email:active?.email||'',label:active?.label||''};}
  emit(extra={}){this.onChange({...this.status(),...extra});}
  async discovery(){
    if(this.metadata)return this.metadata;
    const response=await this.fetch(`${ISSUER}/.well-known/openid-configuration`,{signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error('Não foi possível consultar o serviço de login da OpenAI.');
    const m=await response.json();
    if(m.issuer!==ISSUER)throw new Error('Emissor de autenticação inesperado.');
    for(const k of ['jwks_uri','revocation_endpoint'])if(m[k]&&new URL(m[k]).origin!==ISSUER)throw new Error('Endpoint de autenticação inesperado.');
    this.metadata=m;return m;
  }
  async verify(idToken,clientId,nonce){
    let claims;
    if(this.verifyToken)claims=await this.verifyToken(idToken,clientId);
    else {const {createRemoteJWKSet,jwtVerify}=await import('jose');const m=await this.discovery();this.jwks ||= createRemoteJWKSet(new URL(m.jwks_uri));const result=await jwtVerify(idToken,this.jwks,{issuer:ISSUER,audience:clientId,clockTolerance:5,algorithms:['RS256','ES256']});claims=result.payload;}
    if(!claims.sub||!safeEqual(claims.nonce,nonce))throw new Error('A identidade retornada não corresponde a esta tentativa de login.');
    return claims;
  }
  cancel(){if(!this.pending)return;clearTimeout(this.pending.timer);this.pending.server.close();this.pending=null;this.emit();}
  async signIn({profileId,newAccount=false}={}){
    if(!this.storage.isEncryptionAvailable())throw new Error('Armazenamento seguro indisponível.');
    this.cancel();
    const previous=newAccount?null:this.vault.profiles.find(p=>p.id===(profileId||this.vault.activeId));
    const clientId=previous?.clientId||(!newAccount&&this.vault.retryClientId)||'dynamic_agent_client';
    const verifier=crypto.randomBytes(64).toString('base64url'),state=crypto.randomBytes(32).toString('base64url'),nonce=crypto.randomBytes(32).toString('base64url');
    const server=http.createServer((req,res)=>this.callback(req,res));
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const redirectUri=`http://127.0.0.1:${server.address().port}/auth/callback`;
    const pending={server,verifier,state,nonce,redirectUri,clientId,previous,processing:false};
    pending.timer=setTimeout(()=>{if(this.pending===pending){this.cancel();this.emit({error:'O login expirou. Tente novamente.'});}},180000);
    this.pending=pending;
    const url=new URL(`${ISSUER}/api/accounts/authorize`);
    const params={client_id:clientId,ext_agent_host_id:this.hostId,response_type:'code',redirect_uri:redirectUri,scope:SCOPES,resource:RESOURCE,state,nonce,code_challenge_method:'S256',code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url')};
    if(clientId==='dynamic_agent_client')params.agent_name_hint='Lume';
    if(previous?.idToken)params.id_token_hint=previous.idToken;
    if(previous?.email)params.login_hint=previous.email;
    url.search=new URLSearchParams(params).toString();
    try{await this.openExternal(url.href);this.emit();return {pending:true};}catch{this.cancel();throw new Error('Não foi possível abrir o navegador para entrar com ChatGPT.');}
  }
  async callback(req,res){
    const p=this.pending;
    res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'");
    const url=new URL(req.url,'http://127.0.0.1');
    const finish=(code,success)=>{res.writeHead(code);res.end(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Lume · ChatGPT</title><body style="background:#121212;color:#eee;font:16px system-ui;display:grid;place-items:center;height:90vh"><main><h1>${success?'Conta conectada.':'Não foi possível concluir o login.'}</h1><p>${success?'Você pode fechar esta aba e voltar ao Lume.':'Volte ao Lume e tente novamente.'}</p></main></body></html>`);};
    if(req.method!=='GET'||url.pathname!=='/auth/callback'){finish(404,false);return;}
    if(!p||p.processing||!safeEqual(url.searchParams.get('state'),p.state)){finish(403,false);return;}
    p.processing=true;
    try{
      if(url.searchParams.has('error'))throw new Error('A autorização foi cancelada ou recusada.');
      const returned=url.searchParams.get('client_id');
      if(p.clientId!=='dynamic_agent_client'&&returned&&returned!==p.clientId)throw new Error('O registro retornado não corresponde à conta selecionada.');
      const clientId=p.clientId==='dynamic_agent_client'?returned:p.clientId;
      const code=url.searchParams.get('code');
      if(!code||!clientId||clientId==='dynamic_agent_client'||clientId.length>512)throw new Error('O registro não foi concluído.');
      if(p.clientId==='dynamic_agent_client'){this.vault.retryClientId=clientId;this.persist();}
      const data=await this.exchange({grant_type:'authorization_code',client_id:clientId,code,code_verifier:p.verifier,redirect_uri:p.redirectUri,resource:RESOURCE});
      const identity=await this.verify(data.id_token,clientId,p.nonce);
      if(p.previous&&identity.sub!==p.previous.subject)throw new Error('A conta retornada é diferente da conta selecionada.');
      if(this.pending!==p)throw new Error('Esta tentativa de login foi cancelada.');
      const existing=this.vault.profiles.find(a=>a.clientId===clientId&&a.subject===identity.sub);
      const profile={id:existing?.id||crypto.randomUUID(),subject:identity.sub,clientId,email:identity.email||'',label:existing?.label||`Conta ${this.vault.profiles.length+1}`,idToken:data.id_token,accessToken:data.access_token,refreshToken:data.refresh_token||null,scopes:String(data.scope||'').split(/\s+/).filter(Boolean),expiresAt:Date.now()+Number(data.expires_in||3600)*1000};
      if(!profile.accessToken)throw new Error('A OpenAI não retornou uma credencial de acesso.');
      if(existing)Object.assign(existing,profile);else this.vault.profiles.push(profile);
      this.vault.activeId=profile.id;delete this.vault.retryClientId;this.storageError=null;this.persist();finish(200,true);
      this.cancel();this.emit({signedIn:true});
    }catch(error){finish(400,false);if(this.pending===p){this.cancel();this.emit({error:error.message});}}
  }
  async exchange(fields){
    const response=await this.fetch(`${ISSUER}/api/accounts/oauth/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(fields),signal:AbortSignal.timeout(25000)});
    let data;try{data=await response.json();}catch{throw new Error('O serviço de login retornou uma resposta inválida.');}
    if(!response.ok){const error=new Error(data.error==='invalid_grant'?'A autorização expirou. Entre novamente com a mesma conta.':'Não foi possível autorizar esta conexão.');error.code=data.error;throw error;}return data;
  }
  async access(profileId=this.vault.activeId){
    const p=this.vault.profiles.find(item=>item.id===profileId);if(!p?.accessToken)throw new Error('Entre com ChatGPT para começar.');
    if(!p.scopes?.includes(PLAN_SCOPE))throw new Error('Autorize o uso do plano ChatGPT nas permissões desta conexão.');
    if(p.expiresAt>Date.now()+60000)return p.accessToken;
    if(!p.refreshToken)throw new Error('Sua sessão expirou. Entre novamente.');
    if(this.refreshing.has(p.id))return this.refreshing.get(p.id);
    const previousToken=p.refreshToken;
    const promise=(async()=>{
      try{const next=await this.exchange({grant_type:'refresh_token',client_id:p.clientId,refresh_token:previousToken,resource:RESOURCE});
        if(this.vault.profiles.find(a=>a.id===p.id)?.refreshToken!==previousToken)throw new Error('A conexão mudou durante a renovação.');
        if(!next.access_token)throw new Error('A renovação não retornou uma credencial.');
        Object.assign(p,{accessToken:next.access_token,refreshToken:next.refresh_token||previousToken,idToken:next.id_token||p.idToken,scopes:next.scope?next.scope.split(/\s+/):p.scopes,expiresAt:Date.now()+Number(next.expires_in||3600)*1000});this.persist();this.emit();return p.accessToken;
      }catch(e){if(e.code==='invalid_grant'&&p.refreshToken===previousToken){delete p.accessToken;delete p.refreshToken;delete p.idToken;this.persist();this.emit();}throw e;}
      finally{this.refreshing.delete(p.id);}
    })();this.refreshing.set(p.id,promise);return promise;
  }
  select(id){const p=this.vault.profiles.find(a=>a.id===id);if(!p)throw new Error('Conta não encontrada.');this.vault.activeId=id;this.persist();this.emit();return this.status();}
  async signOut(){
    this.cancel();const p=this.active();if(!p)return {revoked:true};let revoked=!p.refreshToken;
    if(p.refreshToken){try{const m=await this.discovery();if(m.revocation_endpoint){for(let i=0;i<2&&!revoked;i++){const r=await this.fetch(m.revocation_endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:p.refreshToken,token_type_hint:'refresh_token',client_id:p.clientId}),signal:AbortSignal.timeout(12000)});revoked=r.ok;if(r.status<500&&!r.ok)break;}}}catch{}}
    delete p.accessToken;delete p.refreshToken;delete p.idToken;this.persist();this.emit();return {revoked};
  }
}
module.exports={ChatGPTAuth,ISSUER,RESOURCE,PLAN_SCOPE,safeEqual};

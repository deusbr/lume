const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {atomic}=require('../secret-vault.cjs');
const {clip,within,remoteUrl,jsonResponse,textResponse}=require('./common.cjs');

class ObsidianConnector {
  constructor({connection,secrets,fetchImpl=fetch}) { Object.assign(this,{connection,secrets,fetch:fetchImpl}); }
  static detect(configFile=path.join(process.env.APPDATA||'','obsidian','obsidian.json')) {
    if (!fs.existsSync(configFile)) return [];
    const stat=fs.statSync(configFile); if(stat.size>1024*1024)throw new Error('O registro do Obsidian é muito grande.');
    const config=JSON.parse(fs.readFileSync(configFile,'utf8'));
    return Object.values(config.vaults||{}).filter(v=>typeof v.path==='string'&&fs.existsSync(v.path)).map(v=>({path:v.path,name:path.basename(v.path),open:!!v.open}));
  }
  root() {
    const root=this.connection.vaultPath;
    if(!root||!fs.existsSync(root)||!fs.statSync(root).isDirectory())throw new Error('Escolha uma pasta de notas existente.');
    return fs.realpathSync(root);
  }
  files() {
    const root=this.root(),result=[];let visited=0;
    const walk=(directory,depth)=>{
      if(depth>12||result.length>=3000)return;
      for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
        if(++visited>20000||result.length>=3000)break;
        if(entry.name.startsWith('.')||entry.isSymbolicLink())continue;
        const full=path.join(directory,entry.name);
        if(entry.isDirectory())walk(full,depth+1);
        else if(entry.isFile()&&/\.md$/i.test(entry.name)&&fs.statSync(full).size<=1024*1024)result.push(path.relative(root,full).replaceAll('\\','/'));
      }
    };walk(root,0);return result;
  }
  async search({query='',limit=40}={}) {
    if(this.connection.restUrl)return this.restSearch({query,limit});
    const q=clip(query,200).toLocaleLowerCase(), matches=[];
    for(const name of this.files()){
      const target=within(this.root(),name),value=fs.readFileSync(target,'utf8');const at=value.toLocaleLowerCase().indexOf(q);
      if(!q||name.toLocaleLowerCase().includes(q)||at>=0)matches.push({id:name,name,path:name,source:'obsidian',snippet:value.slice(Math.max(0,at-80),Math.max(0,at-80)+240),updatedAt:fs.statSync(target).mtime.toISOString()});
      if(matches.length>=Math.min(100,Math.max(1,Number(limit)||40)))break;
    }
    return {documents:matches,limited:matches.length>=Math.min(100,Math.max(1,Number(limit)||40))};
  }
  async read({path:name}={}) {
    if(!/\.md$/i.test(name||''))throw new Error('Selecione uma nota Markdown.');
    if(this.connection.restUrl)return this.rest(`/vault/${this.encodeName(name)}`,'GET');
    const target=within(this.root(),name),stat=fs.statSync(target);if(stat.size>1024*1024)throw new Error('A nota ultrapassa 1 MB.');
    return {id:name,name,source:'obsidian',text:fs.readFileSync(target,'utf8'),revision:crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex')};
  }
  async write({path:name,text='',mode='create',revision}={}) {
    if(!/\.md$/i.test(name||'')||Buffer.byteLength(text)>1024*1024)throw new Error('Use uma nota Markdown de até 1 MB.');
    if(this.connection.restUrl){if(mode==='append')return this.rest(`/vault/${this.encodeName(name)}`,'POST',text);if(mode!=='create')throw new Error('Use anexar ou criar no Local REST; substituição exige revisão da nota local.');try{await this.rest(`/vault/${this.encodeName(name)}`,'GET');throw new Error('A nota já existe. Escolha outro nome.');}catch(e){if(e.status!==404)throw e;}return this.rest(`/vault/${this.encodeName(name)}`,'PUT',text);}
    const root=this.root(),target=within(root,name,{mustExist:false});
    let content=text;
    if(fs.existsSync(target)){
      if(mode==='create')throw new Error('A nota já existe. Escolha outro nome ou anexe ao conteúdo.');
      const previous=await this.read({path:name});
      if(mode==='replace'&&(!revision||revision!==previous.revision))throw new Error('A nota mudou. Leia a versão atual antes de substituir.');
      if(mode==='append')content=previous.text+'\n\n'+text;
      else if(mode!=='replace')throw new Error('Modo de gravação inválido.');
      if(Buffer.byteLength(content)>1024*1024)throw new Error('A nota ultrapassaria 1 MB.');
      atomic(`${target}.lume-backup-${Date.now()}`,previous.text);
    }
    fs.mkdirSync(path.dirname(target),{recursive:true});within(root,name,{mustExist:false});atomic(target,content);
    return {saved:true,path:name,source:'obsidian'};
  }
  encodeName(name){withinPath(name);return name.split(/[\\/]/).map(encodeURIComponent).join('/');}
  async rest(route,method='GET',body) {
    const url=remoteUrl(this.connection.restUrl);if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw new Error('O Local REST precisa estar neste computador.');
    if(!this.secrets.apiKey)throw new Error('Configure o token do Local REST no campo protegido.');
    const response=await this.fetch(new URL(route,url),{method,headers:{Authorization:`Bearer ${this.secrets.apiKey}`,Accept:method==='GET'?'text/markdown':'application/json','Content-Type':'text/markdown'},body,signal:AbortSignal.timeout(20000)});
    if(!response.ok){const error=new Error(`Obsidian Local REST: HTTP ${response.status}.`);error.status=response.status;throw error;}
    if(method==='GET'){const text=await textResponse(response,{max:1024*1024});return {text,source:'obsidian',path:decodeURIComponent(route.slice(7))};}
    return {saved:true,source:'obsidian'};
  }
  async restSearch({query,limit}) {
    const url=remoteUrl(this.connection.restUrl);if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw new Error('O Local REST precisa estar neste computador.');
    const endpoint=new URL('/search/simple/',url);endpoint.searchParams.set('query',clip(query,200));endpoint.searchParams.set('contextLength','120');
    const data=await jsonResponse(await this.fetch(endpoint,{headers:{Authorization:`Bearer ${this.secrets.apiKey||''}`},signal:AbortSignal.timeout(20000)}));
    return {documents:(Array.isArray(data)?data:[]).slice(0,Math.min(100,Number(limit)||40)).map(x=>({id:x.filename,path:x.filename,name:x.filename,source:'obsidian',snippet:clip(x.matches?.[0]?.context,240)}))};
  }
}
function withinPath(value){if(!value||path.isAbsolute(value)||value.includes(':')||value.includes('\0')||value.split(/[\\/]/).includes('..'))throw new Error('Caminho de nota inválido.');}
module.exports={ObsidianConnector};

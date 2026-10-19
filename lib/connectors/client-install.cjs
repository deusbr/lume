const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {atomic}=require('../secret-vault.cjs');
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value===undefined?null:value)).digest('hex');
function knownClients(home=os.homedir(),appdata=process.env.APPDATA||path.join(home,'.config')){return [
  {id:'codex',name:'Codex',format:'toml',path:path.join(process.env.CODEX_HOME||path.join(home,'.codex'),'config.toml')},
  {id:'cursor',name:'Cursor',format:'json',path:path.join(home,'.cursor','mcp.json')},
  {id:'claude-desktop',name:'Claude Desktop',format:'json',path:path.join(appdata,'Claude','claude_desktop_config.json')},
  {id:'claude-code',name:'Claude Code',format:'json',path:path.join(home,'.claude.json')},
  {id:'custom',name:'Outro cliente / Grok (JSON compatível)',format:'json',requiresFile:true}
];}
function readConfig(filename){if(!fs.existsSync(filename))return '';const st=fs.lstatSync(filename);if(!st.isFile()||st.isSymbolicLink()||st.size>2*1024*1024)throw new Error('Arquivo de configuração inválido ou muito grande.');return fs.readFileSync(filename,'utf8');}
function codexSections(text){
  const lines=text.split(/(?<=\n)/),ranges=[];let start=-1,offset=0;
  for(const line of lines){const header=line.trim().match(/^\[([^\]]+)\]/);if(header){const owned=/^mcp_servers\.(?:lume|"lume"|'lume')(?:\.|$)/.test(header[1]);if(start>=0&&!owned){ranges.push([start,offset]);start=-1;}if(owned&&start<0)start=offset;}offset+=line.length;}
  if(start>=0)ranges.push([start,text.length]);return ranges;
}
function getCodex(text){return codexSections(text).map(([s,e])=>text.slice(s,e)).join('');}
function replaceCodex(text,entry){let out=text;for(const [start,end]of codexSections(text).reverse())out=out.slice(0,start)+out.slice(end);if(entry)out=out.trimEnd()+'\n\n'+entry.trimEnd()+'\n';return out;}
class ClientInstaller {
  constructor({directory,vault,app,clients=knownClients()}){Object.assign(this,{directory,vault,app,clients});}
  definition(){const root=this.app?.getAppPath?.()||path.resolve(__dirname,'../..');const packaged=!!this.app?.isPackaged;const script=packaged?path.join(process.resourcesPath,'integrations','mcp-server.cjs'):path.join(root,'integrations','mcp-server.cjs');return {command:process.execPath,args:[script],env:{ELECTRON_RUN_AS_NODE:'1',LUME_DATA_DIR:this.directory}};}
  status(){const saved=this.vault.get('device','client-install').installations||{};return this.clients.map(client=>({id:client.id,name:client.name,path:client.path||'',requiresFile:!!client.requiresFile,exists:!!client.path&&fs.existsSync(client.path),installed:!!saved[client.id],installedPath:saved[client.id]?.path||'',restartRequired:!!saved[client.id]}));}
  locate({clientId,configFile}){const client=this.clients.find(c=>c.id===clientId);if(!client)throw new Error('Cliente não suportado.');const target=configFile||client.path;if(!target||!path.isAbsolute(target))throw new Error('Selecione o arquivo JSON de configuração do cliente.');return {...client,path:target};}
  async install(input){
    const client=this.locate(input),text=readConfig(client.path),definition=this.definition(),saved=this.vault.get('device','client-install').installations||{},prior=saved[client.id];let next,previous,installed;
    if(client.format==='toml'){
      previous=getCodex(text);installed=`[mcp_servers.lume]\ncommand = ${JSON.stringify(definition.command)}\nargs = ${JSON.stringify(definition.args)}\n\n[mcp_servers.lume.env]\nELECTRON_RUN_AS_NODE = "1"\nLUME_DATA_DIR = ${JSON.stringify(this.directory)}\n`;
      if(prior&&prior.path===client.path&&hash(previous)!==prior.installedHash)throw new Error('A entrada Lume foi modificada nesse cliente. Remova ou revise essa entrada antes de reinstalar.');next=replaceCodex(text,installed);
    }else{
      let data;try{data=text?JSON.parse(text):{};}catch{throw new Error('O arquivo do cliente contém JSON inválido. Corrija-o antes de instalar.');}if(!data||Array.isArray(data)||typeof data!=='object'||data.mcpServers&&typeof data.mcpServers!=='object')throw new Error('Configuração MCP incompatível.');
      previous=data.mcpServers?.lume;installed=definition;if(prior&&prior.path===client.path&&hash(previous)!==prior.installedHash)throw new Error('A entrada Lume foi modificada nesse cliente. Revise-a antes de reinstalar.');data.mcpServers={...data.mcpServers,lume:definition};next=JSON.stringify(data,null,2)+'\n';
    }
    // Full backups and the previous Lume entry are encrypted, even if another client's configuration contains secrets.
    const record={path:client.path,format:client.format,installedHash:hash(installed),previous:prior&&prior.path===client.path?prior.previous:previous,backup:text,installedAt:new Date().toISOString()};
    this.vault.set('device','client-install',{installations:{...saved,[client.id]:record}});
    try{atomic(client.path,next);}catch(error){this.vault.set('device','client-install',{installations:saved});throw error;}
    return {installed:true,clientId:client.id,path:client.path,restartRequired:true};
  }
  async remove(input){
    const saved=this.vault.get('device','client-install').installations||{},record=saved[input.clientId];if(!record)throw new Error('Não há instalação do Lume registrada para este cliente.');const text=readConfig(record.path);let next;
    if(record.format==='toml'){const installed=getCodex(text);if(hash(installed)!==record.installedHash)throw new Error('A entrada Lume mudou. A remoção foi interrompida para preservar sua edição.');next=replaceCodex(text,record.previous||'');}
    else{const data=JSON.parse(text);if(hash(data.mcpServers?.lume)!==record.installedHash)throw new Error('A entrada Lume mudou. A remoção foi interrompida para preservar sua edição.');if(record.previous===undefined)delete data.mcpServers.lume;else data.mcpServers.lume=record.previous;next=JSON.stringify(data,null,2)+'\n';}
    atomic(record.path,next);const remaining={...saved};delete remaining[input.clientId];this.vault.set('device','client-install',{installations:remaining});return {removed:true,path:record.path,restartRequired:true};
  }
}
module.exports={ClientInstaller,knownClients,getCodex,replaceCodex};

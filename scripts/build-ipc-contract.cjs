const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');const names=new Set(['boot']);
for(const file of ['electron/application.cjs','electron/desktop-service.cjs','lib/audio-service.cjs','lib/local-engine.cjs','lib/integration-service.cjs','lib/updater.cjs']){
 const source=fs.readFileSync(path.join(root,file),'utf8');for(const match of source.matchAll(/['"]([a-z][a-zA-Z0-9]*\.[a-zA-Z0-9.]+)['"]\s*:/g))names.add(match[1]);
}
const methods=JSON.stringify([...names].sort());
fs.writeFileSync(path.join(root,'electron/preload.cjs'),`const {contextBridge,ipcRenderer}=require('electron');\nconst methods=new Set(${methods});\ncontextBridge.exposeInMainWorld('lume',{\n call:(method,args)=>{if(!methods.has(method))return Promise.reject(new Error('Operação indisponível.'));return ipcRenderer.invoke('lume:call',method,args).then(r=>{if(!r.ok)throw new Error(r.error);return r.data;});},\n on:callback=>{if(typeof callback!=='function')return()=>{};const handler=(_event,data)=>callback(data);ipcRenderer.on('lume:event',handler);return()=>ipcRenderer.removeListener('lume:event',handler);}\n});\n`);
console.log(`IPC allowlist: ${names.size} methods.`);

// Staging executable check only. This is deliberately separate from final release acceptance.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {_electron}=require('@playwright/test');
async function sha256(filename){const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(filename))hash.update(chunk);return hash.digest('hex');}
async function main(){
  const root=path.resolve(__dirname,'..'),executablePath=path.resolve(process.env.LUME_STAGING_EXECUTABLE||path.join(root,'../../outputs/lume-build/win-unpacked/Lume.exe'));
  const directory=path.resolve(root,'..',`test-packaged-staging-${crypto.randomUUID()}`),userdata=path.join(directory,'userdata');fs.mkdirSync(directory,{recursive:true});
  const asarPath=path.join(path.dirname(executablePath),'resources','app.asar'),metadata={classification:'staging-build-only',executablePath,executableBytes:fs.statSync(executablePath).size,executableSha256:await sha256(executablePath),asarPath,asarBytes:fs.statSync(asarPath).size,asarSha256:await sha256(asarPath),userdata};
  let app,stderr='',pageErrors=[];
  try{
    const env={...process.env,LUME_TEST_DATA:userdata};delete env.ELECTRON_RUN_AS_NODE;
    app=await _electron.launch({executablePath,args:[],cwd:path.dirname(executablePath),env,timeout:30000});app.process().stderr.on('data',chunk=>{stderr+=chunk.toString().slice(0,16000);});
    await app.evaluate(()=>{globalThis.fetch=async()=>{throw new Error('Rede externa bloqueada no smoke isolado.');};});
    const page=await app.firstWindow({timeout:20000});page.on('pageerror',error=>pageErrors.push(error.message));await page.waitForFunction(()=>!!window.lume,{timeout:15000});
    const boot=await page.evaluate(()=>window.lume.call('boot'));assert.equal(boot.auth.connected,false);assert.equal(boot.auth.profiles.length,0);
    const modules=await app.evaluate(({app})=>{
      const fixtureRequire=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json'),fs=fixtureRequire('node:fs'),path=fixtureRequire('node:path'),crypto=fixtureRequire('node:crypto');
      const {ChatGPTAuth}=fixtureRequire('./lib/chatgpt-auth.cjs'),publicKey=path.join(app.getAppPath(),'release-public-key.pem');
      return {isPackaged:app.isPackaged,appPath:app.getAppPath(),userData:app.getPath('userData'),electron:process.versions.electron,node:process.versions.node,chatGPTAuth:{modulePresent:typeof ChatGPTAuth==='function',signIn:typeof ChatGPTAuth.prototype.signIn==='function',verify:typeof ChatGPTAuth.prototype.verify==='function',access:typeof ChatGPTAuth.prototype.access==='function'},updatePublicKey:{present:fs.existsSync(publicKey),sha256:fs.existsSync(publicKey)?crypto.createHash('sha256').update(fs.readFileSync(publicKey)).digest('hex'):null},privateUpdateKeyPackaged:fs.existsSync(path.join(app.getAppPath(),'release-private-key.pem'))};
    });
    assert.equal(modules.isPackaged,true);assert.equal(path.resolve(modules.userData),path.resolve(userdata));assert.equal(modules.chatGPTAuth.modulePresent,true);assert.equal(modules.chatGPTAuth.signIn,true);assert.equal(modules.privateUpdateKeyPackaged,false);
    await page.screenshot({path:path.join(directory,'staging-boot.png'),fullPage:true});
    const report={ok:true,...metadata,boot:{version:boot.version,profileId:boot.workspace.profileId,connected:boot.auth.connected,profiles:boot.auth.profiles.length},modules,pageErrors,stderr};fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({ok:true,classification:metadata.classification,version:boot.version,modules,asarSha256:metadata.asarSha256,pageErrors,report:path.join(directory,'report.json')}));
  }catch(error){const report={ok:false,...metadata,error:error.message,stack:error.stack,stderr,pageErrors};fs.writeFileSync(path.join(directory,'failure.json'),JSON.stringify(report,null,2));console.error(JSON.stringify({ok:false,error:error.message,report:path.join(directory,'failure.json')}));throw error;}
  finally{if(app)await app.close();}
}
if(require.main===module)main().catch(()=>{process.exitCode=1;});
module.exports={main};

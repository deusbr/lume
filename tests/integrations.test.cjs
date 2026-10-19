const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const http=require('node:http');
const {Store}=require('../lib/store.cjs');
const {SecretVault}=require('../lib/secret-vault.cjs');
const {IntegrationService}=require('../lib/integration-service.cjs');
const {AssistantSync}=require('../lib/assistant-sync.cjs');
const {GoogleConnector}=require('../lib/connectors/google.cjs');
const {MCPConnector}=require('../lib/connectors/mcp.cjs');
const {ObsidianConnector}=require('../lib/connectors/obsidian.cjs');
const {ClientInstaller}=require('../lib/connectors/client-install.cjs');
const {loopback,within}=require('../lib/connectors/common.cjs');
const {payloadFor}=require('../integrations/mcp-server.cjs');
const {readHandoff,writeBridge}=require('../lib/handoff.cjs');

function temp(t){const folder=fs.mkdtempSync(path.join(os.tmpdir(),'lume-integration-test-'));t.integrationCleanup=[];t.after(async()=>{for(const dispose of t.integrationCleanup)await dispose();fs.rmSync(folder,{recursive:true,force:true});});return folder;}
function fixtureStorage(){const key=crypto.randomBytes(32);return {isEncryptionAvailable:()=>true,encryptString(value){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,cipher.getAuthTag?Buffer.alloc(0):Buffer.alloc(0),cipher.update(value,'utf8'),cipher.final(),cipher.getAuthTag()]);},decryptString(buffer){const iv=buffer.subarray(0,12),decipher=crypto.createDecipheriv('aes-256-gcm',key,iv);decipher.setAuthTag(buffer.subarray(-16));return Buffer.concat([decipher.update(buffer.subarray(12,-16)),decipher.final()]).toString('utf8');}};}
function serviceFixture(t,extra={}){const directory=temp(t),store=new Store(directory),storage=fixtureStorage(),events=[];let profile='local';const service=new IntegrationService({directory,store,storage,getProfile:()=>profile,emit:event=>events.push(event),...extra});t.integrationCleanup.push(()=>service.dispose(),()=>store.close());return {directory,store,storage,service,events,switchProfile(id){profile=id;store.setProfile(id);}};}
const response=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
async function server(t,handler){const s=http.createServer(handler);await new Promise(resolve=>s.listen(0,'127.0.0.1',resolve));t.after(()=>{s.closeAllConnections();s.close();});return {server:s,url:`http://127.0.0.1:${s.address().port}`};}

test('integration vault encrypts secrets, isolates profiles, and rejects plaintext persistence',t=>{
  const directory=temp(t),storage=fixtureStorage(),vault=new SecretVault({directory,storage});vault.set('alice','mcp',{bearerToken:'fixture-secret-value'});assert.equal(vault.get('bob','mcp').bearerToken,undefined);assert.equal(fs.readFileSync(vault.filename).includes(Buffer.from('fixture-secret-value')),false);
  const reopened=new SecretVault({directory,storage});assert.equal(reopened.get('alice','mcp').bearerToken,'fixture-secret-value');vault.delete('alice','mcp');assert.deepEqual(vault.get('alice','mcp'),{});
  const unavailable=new SecretVault({directory:path.join(directory,'unavailable'),storage:{isEncryptionAvailable:()=>false}});assert.throws(()=>unavailable.set('alice','mcp',{token:'x'}),/texto/);
});

test('Obsidian confines reads and writes, refuses stale replacement, and preserves originals',async t=>{
  const root=temp(t);fs.writeFileSync(path.join(root,'daily.md'),'Reunião e decisões');const c=new ObsidianConnector({connection:{vaultPath:root},secrets:{}});
  assert.equal((await c.search({query:'decisões'})).documents[0].path,'daily.md');const old=await c.read({path:'daily.md'});assert.match(old.text,/Reunião/);
  await assert.rejects(c.read({path:'../outside.md'}),/inválido/);await assert.rejects(c.write({path:'daily.md',text:'sobrescrever'}),/já existe/);
  await assert.rejects(c.write({path:'daily.md',text:'x',mode:'replace',revision:'stale'}),/mudou/);
  await c.write({path:'daily.md',text:'Novos passos',mode:'append'});assert.match((await c.read({path:'daily.md'})).text,/Novos passos/);assert.ok(fs.readdirSync(root).some(f=>f.includes('lume-backup')));
  await c.write({path:'Resumo/sessão.md',text:'Resumo final'});assert.equal((await c.read({path:'Resumo/sessão.md'})).text,'Resumo final');
  assert.throws(()=>within(root,'C:\\Windows\\win.ini'),/inválido/);
});

test('Obsidian writes need a one-use, exact, profile-bound approval and documents stay isolated',async t=>{
  const f=serviceFixture(t),vaultPath=path.join(f.directory,'notes');fs.mkdirSync(vaultPath);const connection=await f.service.operations['connections.save']({kind:'obsidian',vaultPath,name:'Notas'});await f.service.operations['connections.connect']({connectionId:connection.id});
  const args={connectionId:connection.id,name:'note_write',arguments:{path:'review.md',text:'Aprovado'},sessionId:'session-alice',requestId:'write-1'};
  const proposed=await f.service.executeTool(args);assert.equal(proposed.pendingApproval,true);assert.equal(fs.existsSync(path.join(vaultPath,'review.md')),false);assert.equal(f.events.at(-1).type,'tool-approval');
  f.switchProfile('bob');await assert.rejects(f.service.approve({approvalId:proposed.approvalId}),/outro perfil/);f.switchProfile('local');
  const result=await f.service.approve({approvalId:proposed.approvalId});assert.equal(result.profileId,'local');assert.equal(result.sessionId,'session-alice');assert.equal(result.requestId,'write-1');assert.equal(fs.readFileSync(path.join(vaultPath,'review.md'),'utf8'),'Aprovado');
  await assert.rejects(f.service.approve({approvalId:proposed.approvalId}),/expirou/);
  await f.service.executeTool({connectionId:connection.id,name:'notes_search',arguments:{query:'Aprovado'}});assert.equal(f.service.documents().length,1);f.switchProfile('bob');assert.deepEqual(f.service.documents(),[]);assert.deepEqual(f.service.listConnections(),[]);
});

test('connection secrets never enter workspace rows or tool definitions',async t=>{
  const f=serviceFixture(t);const connection=await f.service.saveConnection({kind:'mcp',transport:'stdio',command:process.execPath,args:['fixture.cjs'],env:{TOKEN:'fixture-private'},bearerToken:'fixture-bearer'});
  assert.equal(JSON.stringify(f.store.connections()).includes('fixture-private'),false);assert.equal(JSON.stringify(f.service.listConnections()).includes('fixture-bearer'),false);assert.equal(f.service.vault.get('local',connection.id).env.TOKEN,'fixture-private');
  await assert.rejects(f.service.saveConnection({kind:'mcp',url:'https://example.com/mcp?token=secret'}),/credenciais/);
});

test('folder sync imports remote changes, preserves conflicts, and excludes credentials and machine paths',async t=>{
  const directory=temp(t),folder=path.join(directory,'shared');fs.mkdirSync(folder);const a=new Store(path.join(directory,'a')),b=new Store(path.join(directory,'b'));t.integrationCleanup.push(()=>a.close(),()=>b.close());
  const aa=new AssistantSync({store:a,profileId:'local',deviceId:'a'}),bb=new AssistantSync({store:b,profileId:'local',deviceId:'b'});aa.choose(folder);bb.choose(folder);
  a.assistant({id:'shared-assistant',name:'Original',instructions:'Base',files:[{name:'base.txt',text:'Conhecimento',path:'C:\\private\\base.txt'}]});a.settings({theme:'light',vaultPath:'C:\\private',whisperBinary:'C:\\secret.exe',googleToken:'never'});
  await aa.run('push');await bb.run('pull');assert.equal(b.assistants().find(x=>x.id==='shared-assistant').instructions,'Base');const themeConflict=bb.conflicts().find(c=>c.key==='theme');assert.ok(themeConflict);bb.resolve({id:themeConflict.id,choice:'remote'});assert.equal(b.getSettings().theme,'light');const synced=fs.readFileSync(path.join(folder,'lume-sync-v1.json'),'utf8');assert.equal(synced.includes('C:\\\\private'),false);assert.equal(synced.includes('never'),false);
  a.assistant({...a.assistants().find(x=>x.id==='shared-assistant'),instructions:'Mudou A'});b.assistant({...b.assistants().find(x=>x.id==='shared-assistant'),instructions:'Mudou B'});await aa.run('push');const status=await bb.run('pull');const conflict=status.conflicts.find(c=>c.key==='shared-assistant');assert.ok(conflict);assert.equal(b.assistants().find(x=>x.id==='shared-assistant').instructions,'Mudou B');
  bb.resolve({id:conflict.id,choice:'both'});assert.ok(b.assistants().some(x=>x.name==='Original (sincronizado)'&&x.instructions==='Mudou A'));assert.ok(fs.readdirSync(path.join(folder,'lume-revisions')).length>=2);
});

test('sync deletion uses the common baseline and never deletes independently created assistants',async t=>{
  const directory=temp(t),folder=path.join(directory,'shared');fs.mkdirSync(folder);const a=new Store(path.join(directory,'a')),b=new Store(path.join(directory,'b'));t.integrationCleanup.push(()=>a.close(),()=>b.close());const aa=new AssistantSync({store:a,profileId:'local'}),bb=new AssistantSync({store:b,profileId:'local'});aa.choose(folder);bb.choose(folder);a.assistant({id:'deletable',name:'Eliminar'});await aa.run('push');await bb.run('pull');a.deleteAssistant('deletable');await aa.run('push');await bb.run('pull');assert.equal(b.assistants().some(x=>x.id==='deletable'),false);assert.ok(b.assistants().length>0);
});

test('client installation and removal preserve unrelated edits and restore an existing Lume entry',async t=>{
  const directory=temp(t),vault=new SecretVault({directory,storage:fixtureStorage()}),jsonFile=path.join(directory,'cursor.json'),tomlFile=path.join(directory,'config.toml');
  fs.writeFileSync(jsonFile,JSON.stringify({mcpServers:{other:{command:'existing'},lume:{command:'old-lume'}},theme:'dark'}));fs.writeFileSync(tomlFile,'model = "model"\n\n[mcp_servers.other]\ncommand = "other"\n\n[mcp_servers.lume]\ncommand = "old-lume"\n\n[features]\nexample = true\n');
  const clients=[{id:'cursor',format:'json',path:jsonFile},{id:'codex',format:'toml',path:tomlFile}],installer=new ClientInstaller({directory,vault,clients,app:{isPackaged:false,getAppPath:()=>path.resolve(__dirname,'..')}});
  await installer.install({clientId:'cursor'});let config=JSON.parse(fs.readFileSync(jsonFile,'utf8'));config.theme='light';fs.writeFileSync(jsonFile,JSON.stringify(config));await installer.remove({clientId:'cursor'});config=JSON.parse(fs.readFileSync(jsonFile,'utf8'));assert.equal(config.mcpServers.lume.command,'old-lume');assert.equal(config.mcpServers.other.command,'existing');assert.equal(config.theme,'light');
  await installer.install({clientId:'codex'});assert.match(fs.readFileSync(tomlFile,'utf8'),/ELECTRON_RUN_AS_NODE/);await installer.remove({clientId:'codex'});assert.match(fs.readFileSync(tomlFile,'utf8'),/command = "old-lume"/);assert.match(fs.readFileSync(tomlFile,'utf8'),/\[features\]/);
});

test('client removal refuses to overwrite a subsequently modified Lume entry',async t=>{
  const directory=temp(t),file=path.join(directory,'client.json'),installer=new ClientInstaller({directory,vault:new SecretVault({directory,storage:fixtureStorage()}),clients:[{id:'fixture',format:'json',path:file}]});await installer.install({clientId:'fixture'});fs.writeFileSync(file,JSON.stringify({mcpServers:{lume:{command:'changed'}}}));await assert.rejects(installer.remove({clientId:'fixture'}),/mudou/);assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).mcpServers.lume.command,'changed');
});

test('Google OAuth uses desktop client, PKCE, loopback state and encrypted tokens (offline fixture)',async t=>{
  const directory=temp(t),vault=new SecretVault({directory,storage:fixtureStorage()});let authorizeUrl,tokenBody;const connector=new GoogleConnector({connection:{id:'google'},profileId:'alice',vault,openExternal:async url=>{authorizeUrl=new URL(url);},fetchImpl:async(url,options)=>{assert.equal(url,'https://oauth2.googleapis.com/token');tokenBody=options.body;return response({access_token:'fixture-google-access',refresh_token:'fixture-google-refresh',expires_in:3600});}});t.after(()=>connector.disconnect());
  connector.configure({json:{installed:{client_id:'fixture.apps.googleusercontent.com',client_secret:'fixture-desktop-secret'}}});assert.equal((await connector.connect()).pending,true);assert.equal(authorizeUrl.searchParams.get('code_challenge_method'),'S256');const callback=new URL(authorizeUrl.searchParams.get('redirect_uri'));callback.searchParams.set('state','wrong');callback.searchParams.set('code','fixture-code');assert.equal((await fetch(callback)).status,403);
  callback.searchParams.set('state',authorizeUrl.searchParams.get('state'));assert.equal((await fetch(callback)).status,200);assert.equal(tokenBody.get('client_id'),'fixture.apps.googleusercontent.com');assert.equal(crypto.createHash('sha256').update(tokenBody.get('code_verifier')).digest('base64url'),authorizeUrl.searchParams.get('code_challenge'));assert.equal(vault.get('alice','google').googleTokens.access_token,'fixture-google-access');assert.equal(fs.readFileSync(vault.filename).includes(Buffer.from('fixture-google-access')),false);
});

test('Google reads paginated Drive/Calendar and Docs/Sheets using only official read APIs (offline fixture)',async t=>{
  const directory=temp(t),vault=new SecretVault({directory,storage:fixtureStorage()}),calls=[];vault.set('alice','google',{googleTokens:{access_token:'fixture',expiresAt:Date.now()+3600000}});
  const connector=new GoogleConnector({connection:{id:'google'},profileId:'alice',vault,fetchImpl:async(input,options)=>{const url=new URL(input);calls.push(url);assert.equal(options.headers.Authorization,'Bearer fixture');if(url.pathname==='/drive/v3/files')return response({files:[{id:'doc-one',name:'Documento',mimeType:'application/vnd.google-apps.document'}],nextPageToken:'page-two'});if(url.pathname==='/drive/v3/files/doc-one')return response({id:'doc-one',name:'Documento',mimeType:'application/vnd.google-apps.document'});if(url.hostname==='docs.googleapis.com')return response({tabs:[{documentTab:{body:{content:[{paragraph:{elements:[{textRun:{content:'Texto do documento\n'}}]}}]}}}]});if(url.pathname.includes('calendarList'))return response({items:[{id:'primary',summary:'Agenda'}],nextPageToken:'next-calendar'});if(url.pathname.endsWith('/events'))return response({items:[{id:'event',summary:'Encontro',start:{dateTime:'2026-10-19T10:00:00Z'}}]});throw new Error('Unexpected fixture request');}});
  const search=await connector.execute('drive_search',{query:"O'Brien",pageToken:'page-one'});assert.equal(search.nextPageToken,'page-two');assert.equal(calls[0].searchParams.get('pageToken'),'page-one');assert.match(calls[0].searchParams.get('q'),/O\\'Brien/);assert.equal((await connector.execute('document_read',{id:'doc-one'})).text,'Texto do documento\n');assert.equal((await connector.execute('calendar_list')).nextPageToken,'next-calendar');assert.equal((await connector.execute('calendar_events',{calendarId:'primary',timeMin:'2026-10-19T00:00:00Z'})).events[0].title,'Encontro');
  await assert.rejects(connector.execute('document_read',{id:'../escape'}),/inválido/);
});

test('OAuth completion after a profile switch cannot save credentials (offline fixture)',async t=>{
  const directory=temp(t),vault=new SecretVault({directory,storage:fixtureStorage()});let current=true,url;const connector=new GoogleConnector({connection:{id:'google'},profileId:'alice',vault,assertCurrent(){if(!current)throw new Error('O perfil mudou.');},openExternal:async value=>{url=new URL(value);},fetchImpl:async()=>response({access_token:'must-not-save'})});t.after(()=>connector.disconnect());connector.configure({json:{installed:{client_id:'fixture.apps.googleusercontent.com',client_secret:'fixture'}}});await connector.connect();current=false;const callback=new URL(url.searchParams.get('redirect_uri'));callback.searchParams.set('state',url.searchParams.get('state'));callback.searchParams.set('code','fixture');assert.equal((await fetch(callback)).status,400);assert.equal(vault.get('alice','google').googleTokens,null);
});

test('MCP outgoing stdio uses the real SDK against a local fixture; reads and approved writes work',async t=>{
  const f=serviceFixture(t),script=path.join(f.directory,'server.cjs');fs.writeFileSync(script,`const rl=require('node:readline').createInterface({input:process.stdin});rl.on('line',s=>{const q=JSON.parse(s);if(q.id===undefined)return;let result;if(q.method==='initialize')result={protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};else if(q.method==='tools/list')result={tools:[{name:'read_note',description:'Read fixture',inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:true}},{name:'write_note',description:'Write fixture',inputSchema:{type:'object',properties:{text:{type:'string'}}},annotations:{readOnlyHint:false}}]};else if(q.method==='tools/call')result={content:[{type:'text',text:q.params.name+':'+(q.params.arguments.text||'read')}]};else result={};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,result})+'\\n');});`);
  const connection=await f.service.saveConnection({kind:'mcp',name:'Fixture MCP',transport:'stdio',command:process.execPath,args:[script],auth:'none'});assert.equal((await f.service.connect({connectionId:connection.id})).connected,true);const defs=await f.service.toolDefinitions([connection.id]);assert.equal(defs.length,2);assert.equal(defs[0].type,'function');const result=await f.service.executeTool({name:defs[0].name,arguments:{}});assert.equal(result.content[0].text,'read_note:read');const pending=await f.service.executeTool({name:defs[1].name,arguments:{text:'after-review'}});assert.equal(pending.pendingApproval,true);assert.equal((await f.service.approve({approvalId:pending.approvalId})).content[0].text,'write_note:after-review');await f.service.disconnect({connectionId:connection.id});
});

test('MCP Streamable HTTP uses the actual SDK handshake and tool execution with a local fixture',async t=>{
  const s=await server(t,async(req,res)=>{if(req.method==='DELETE'){res.writeHead(204);return res.end();}if(req.method!=='POST'){res.writeHead(405);return res.end();}let body='';for await(const chunk of req)body+=chunk;const q=JSON.parse(body);if(q.id===undefined){res.writeHead(202);return res.end();}let result={};if(q.method==='initialize')result={protocolVersion:'2025-06-18',serverInfo:{name:'http-fixture',version:'1'},capabilities:{tools:{}}};if(q.method==='tools/list')result={tools:[{name:'read',inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:true}}]};if(q.method==='tools/call')result={content:[{type:'text',text:'http fixture result'}]};res.writeHead(200,{'content-type':'application/json','mcp-session-id':'fixture-session'});res.end(JSON.stringify({jsonrpc:'2.0',id:q.id,result}));});
  const f=serviceFixture(t),connection=await f.service.saveConnection({kind:'mcp',transport:'http',url:s.url+'/mcp',auth:'none'});assert.equal((await f.service.connect({connectionId:connection.id})).connected,true);const result=await f.service.executeTool({connectionId:connection.id,name:'read',arguments:{}});assert.equal(result.content[0].text,'http fixture result');await f.service.disconnect({connectionId:connection.id});
});

test('MCP legacy SSE uses the actual SDK and receives tool responses over the event stream',async t=>{
  let stream;
  const s=await server(t,async(req,res)=>{
    if(req.method==='GET'&&req.url==='/sse'){stream=res;res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'keep-alive'});res.write('event: endpoint\ndata: /messages\n\n');return;}
    if(req.method==='POST'&&req.url==='/messages'){
      let body='';for await(const chunk of req)body+=chunk;const q=JSON.parse(body);res.writeHead(202);res.end();if(q.id===undefined)return;let result={};
      if(q.method==='initialize')result={protocolVersion:'2025-06-18',serverInfo:{name:'sse-fixture',version:'1'},capabilities:{tools:{}}};
      if(q.method==='tools/list')result={tools:[{name:'read_sse',inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:true}}]};
      if(q.method==='tools/call')result={content:[{type:'text',text:'legacy SSE result'}]};
      stream.write(`event: message\ndata: ${JSON.stringify({jsonrpc:'2.0',id:q.id,result})}\n\n`);return;
    }
    res.writeHead(404);res.end();
  });
  const f=serviceFixture(t),connection=await f.service.saveConnection({kind:'mcp',transport:'sse',url:s.url+'/sse',auth:'none'});assert.equal((await f.service.connect({connectionId:connection.id})).connected,true);assert.equal((await f.service.executeTool({connectionId:connection.id,name:'read_sse',arguments:{}})).content[0].text,'legacy SSE result');await f.service.disconnect({connectionId:connection.id});stream.end();
});

test('MCP OAuth performs discovery, dynamic registration, state validation and PKCE with a local fixture',async t=>{
  let origin,authorizeUrl,tokenBody;
  const s=await server(t,async(req,res)=>{
    const route=new URL(req.url,'http://localhost').pathname;const send=value=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value));};
    if(route==='/.well-known/oauth-protected-resource/mcp'||route==='/.well-known/oauth-protected-resource')return send({resource:origin+'/mcp',authorization_servers:[origin]});
    if(route==='/.well-known/oauth-authorization-server')return send({issuer:origin,authorization_endpoint:origin+'/authorize',token_endpoint:origin+'/token',registration_endpoint:origin+'/register',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none']});
    if(route==='/register'){let body='';for await(const chunk of req)body+=chunk;return send({...JSON.parse(body),client_id:'fixture-mcp-client',token_endpoint_auth_method:'none'});}
    if(route==='/token'){let body='';for await(const chunk of req)body+=chunk;tokenBody=new URLSearchParams(body);return send({access_token:'fixture-mcp-token',token_type:'Bearer',expires_in:3600,refresh_token:'fixture-refresh'});}
    if(route==='/mcp'){
      if(req.headers.authorization!=='Bearer fixture-mcp-token'){res.writeHead(401,{'www-authenticate':`Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`});return res.end();}
      if(req.method==='DELETE'){res.writeHead(204);return res.end();}if(req.method!=='POST'){res.writeHead(405);return res.end();}
      let body='';for await(const chunk of req)body+=chunk;const q=JSON.parse(body);if(q.id===undefined){res.writeHead(202);return res.end();}let result={};if(q.method==='initialize')result={protocolVersion:'2025-06-18',serverInfo:{name:'oauth-fixture',version:'1'},capabilities:{tools:{}}};if(q.method==='tools/list')result={tools:[{name:'oauth_read',inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:true}}]};if(q.method==='tools/call')result={content:[{type:'text',text:'OAuth authorized fixture'}]};res.writeHead(200,{'content-type':'application/json','mcp-session-id':'fixture-auth'});return res.end(JSON.stringify({jsonrpc:'2.0',id:q.id,result}));
    }
    res.writeHead(404);res.end();
  });origin=s.url;
  const f=serviceFixture(t,{openExternal:async value=>{authorizeUrl=new URL(value);}}),connection=await f.service.saveConnection({kind:'mcp',transport:'http',url:s.url+'/mcp',auth:'oauth'});
  const first=await f.service.connect({connectionId:connection.id});assert.equal(first.pending,true);assert.ok(authorizeUrl);assert.equal(authorizeUrl.searchParams.get('code_challenge_method'),'S256');const callback=new URL(authorizeUrl.searchParams.get('redirect_uri'));callback.searchParams.set('code','fixture-code');callback.searchParams.set('state','wrong');assert.equal((await fetch(callback)).status,403);callback.searchParams.set('state',authorizeUrl.searchParams.get('state'));assert.equal((await fetch(callback)).status,200);
  assert.equal(tokenBody.get('client_id'),'fixture-mcp-client');assert.equal(crypto.createHash('sha256').update(tokenBody.get('code_verifier')).digest('base64url'),authorizeUrl.searchParams.get('code_challenge'));assert.equal(f.service.listConnections()[0].connected,true);assert.equal((await f.service.executeTool({connectionId:connection.id,name:'oauth_read',arguments:{}})).content[0].text,'OAuth authorized fixture');await f.service.disconnect({connectionId:connection.id});
});

test('handoff v2 transports bounded text files and specialized prompts without executing them; v1 remains readable',t=>{
  const directory=temp(t),payload=payloadFor('prepare_code_review',{files:[{name:'../app.js',text:'const x = 1'}],autoSubmit:true});assert.equal(payload.mode,'code-review');assert.equal(payload.autoSubmit,undefined);assert.equal(payload.files[0].name,'.._app.js');const id=crypto.randomUUID();fs.writeFileSync(path.join(directory,`${id}.json`),JSON.stringify(payload));const read=readHandoff(directory,id);assert.equal(read.files[0].text,'const x = 1');assert.equal(read.mode,'code-review');assert.equal(read.autoSubmit,undefined);assert.equal(fs.existsSync(path.join(directory,`${id}.json`)),false);
});

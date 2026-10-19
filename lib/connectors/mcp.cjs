const {clip,loopback,remoteUrl}=require('./common.cjs');
class MCPConnector {
  constructor({connection,vault,profileId,openExternal,assertCurrent=()=>{},onChange=()=>{},sdk}) {
    Object.assign(this,{connection,vault,profileId,openExternal,assertCurrent,onChange,sdk});this.toolsCache=[];this.pending=null;this.connecting=null;
  }
  secret(){return this.vault.get(this.profileId,this.connection.id);}
  async oauthProvider(){
    const holder=this;let verifier;
    const pending=await loopback({onCode:async(code,url)=>{
      holder.assertCurrent();await holder.transport.finishAuth(url.searchParams);holder.assertCurrent();
      // A failed handshake must use a fresh Client. OAuth registration is retained in the protected vault.
      await holder.client.close().catch(()=>{});holder.client=new holder.sdk.Client({name:'lume',version:'0.2.0'},{capabilities:{}});
      holder.transport=holder.createTransport(holder.provider);await holder.client.connect(holder.transport,{timeout:30000});await holder.refreshTools();holder.pending=null;holder.onChange({connected:true,toolCount:holder.toolsCache.length});
    },onError:error=>{holder.pending=null;holder.onChange({connected:false,error:error.message});}});
    this.pending=pending;
    return {
      get redirectUrl(){return pending.redirectUri;},
      get clientMetadata(){return {client_name:'Lume',redirect_uris:[pending.redirectUri],grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none'};},
      state:()=>pending.state,
      clientInformation:()=>holder.secret().clientInformation,
      saveClientInformation:value=>{holder.assertCurrent();holder.vault.set(holder.profileId,holder.connection.id,{clientInformation:value});},
      tokens:()=>holder.secret().tokens,
      saveTokens:value=>{holder.assertCurrent();holder.vault.set(holder.profileId,holder.connection.id,{tokens:value});},
      redirectToAuthorization:async url=>{holder.assertCurrent();const target=remoteUrl(url);await holder.openExternal(target.href);holder.onChange({pending:true});},
      saveCodeVerifier:value=>{verifier=value;},codeVerifier:()=>{if(!verifier)throw new Error('A tentativa de login expirou.');return verifier;},
      saveDiscoveryState:value=>{holder.discovery=value;},discoveryState:()=>holder.discovery,
      invalidateCredentials:scope=>{holder.assertCurrent();const patch={};if(scope==='all'||scope==='tokens')patch.tokens=null;if(scope==='all'||scope==='client')patch.clientInformation=null;if(scope==='all'||scope==='discovery')holder.discovery=null;if(scope==='all'||scope==='verifier')verifier=null;if(Object.keys(patch).length)holder.vault.set(holder.profileId,holder.connection.id,patch);}
    };
  }
  createTransport(provider){
    const {connection,sdk}=this,secret=this.secret();
    if(connection.transport==='stdio'){
      const {StdioClientTransport,getDefaultEnvironment}=require('@modelcontextprotocol/client/stdio');
      const env={...getDefaultEnvironment(),...(secret.env||{})};
      if(connection.electronNode)env.ELECTRON_RUN_AS_NODE='1';
      return new StdioClientTransport({command:connection.command,args:connection.args||[],env,stderr:'pipe',maxBufferSize:8*1024*1024,...(connection.cwd?{cwd:connection.cwd}:{})});
    }
    const url=remoteUrl(connection.url),headers={...(secret.headers||{})};if(secret.bearerToken)headers.Authorization=`Bearer ${secret.bearerToken}`;
    const options={requestInit:{headers},...(provider?{authProvider:provider}:{})};
    return connection.transport==='sse'?new sdk.SSEClientTransport(url,options):new sdk.StreamableHTTPClientTransport(url,options);
  }
  async connect(){
    this.assertCurrent();if(this.connecting)return this.connecting;
    this.connecting=(async()=>{
      this.sdk||=require('@modelcontextprotocol/client');await this.disconnect();this.provider=this.connection.transport!=='stdio'&&this.connection.auth!=='none'&&!this.secret().bearerToken?await this.oauthProvider():null;
      this.client=new this.sdk.Client({name:'lume',version:'0.2.0'},{capabilities:{}});this.transport=this.createTransport(this.provider);
      // stderr may contain credentials printed by a third-party process; consume without persisting or sending it to renderers.
      this.transport.stderr?.on('data',()=>{});
      try{await this.client.connect(this.transport,{timeout:30000});await this.refreshTools();this.pending?.close();this.pending=null;this.assertCurrent();this.onChange({connected:true,toolCount:this.toolsCache.length});return {connected:true,tools:this.toolsCache};}
      catch(error){if(this.pending&&(error.name==='UnauthorizedError'||error instanceof this.sdk.UnauthorizedError)){return {pending:true};}this.pending?.close();this.pending=null;await this.client.close().catch(()=>{});throw new Error(`Não foi possível conectar o servidor MCP: ${clip(error.message,700)}`);}
    })();try{return await this.connecting;}finally{this.connecting=null;}
  }
  async refreshTools(){
    const tools=[];let cursor;const cursors=new Set();
    do{const result=await this.client.listTools(cursor?{cursor}:undefined,{timeout:30000});this.assertCurrent();tools.push(...result.tools);cursor=result.nextCursor;if(cursor&&cursors.has(cursor))throw new Error('O servidor MCP repetiu uma página de ferramentas.');if(cursor)cursors.add(cursor);}while(cursor&&tools.length<500);
    this.toolsCache=tools.slice(0,500).map(t=>({name:clip(t.name,128),description:clip(t.description,4000),inputSchema:t.inputSchema||{type:'object',properties:{}},annotations:t.annotations||{}}));return this.toolsCache;
  }
  tools(){return this.toolsCache;}
  async execute(name,args,signal){if(!this.client||this.pending)throw new Error('Conecte o servidor MCP antes de usar suas ferramentas.');this.assertCurrent();return this.client.callTool({name,arguments:args},{signal,timeout:90000});}
  async readResource(uri,signal){if(!this.client||this.pending)throw new Error('Conecte o servidor MCP.');this.assertCurrent();return this.client.readResource({uri},{signal,timeout:30000});}
  async disconnect(){this.pending?.close();this.pending=null;const client=this.client;this.client=null;this.toolsCache=[];if(client)await client.close().catch(()=>{});}
}
module.exports={MCPConnector};

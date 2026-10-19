const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

function clip(value, max=128000) { return typeof value === 'string' ? value.slice(0,max) : ''; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function remoteUrl(value) {
  const url = new URL(value);
  if (url.username || url.password || url.hash || !(url.protocol === 'https:' || url.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(url.hostname))) throw new Error('Use HTTPS ou um servidor HTTP no computador local, sem credenciais na URL.');
  if ([...url.searchParams.keys()].some(k=>/token|secret|key|password|authorization/i.test(k))) throw new Error('Coloque credenciais no campo protegido, e não na URL.');
  return url;
}
function safeEqual(a,b) { return typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); }
async function loopback({onCode, onError=()=>{}, milliseconds=180000}) {
  const state = crypto.randomBytes(32).toString('base64url');
  let timer, busy=false;
  const server = http.createServer(async (req,res)=> {
    res.setHeader('Content-Type','text/html; charset=utf-8'); res.setHeader('Cache-Control','no-store'); res.setHeader('Referrer-Policy','no-referrer'); res.setHeader('Content-Security-Policy',"default-src 'none'");
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method !== 'GET' || url.pathname !== '/oauth/callback') { res.writeHead(404); return res.end('Página não encontrada.'); }
    if (!safeEqual(url.searchParams.get('state'),state) || busy) { res.writeHead(403); return res.end('Tentativa de autorização inválida.'); }
    busy=true;
    try {
      if (url.searchParams.has('error')) throw new Error('A autorização foi cancelada ou recusada.');
      const code = url.searchParams.get('code'); if (!code || code.length > 8192) throw new Error('Código de autorização inválido.');
      await onCode(code, url);
      res.writeHead(200); res.end('Conta conectada. Feche esta aba e volte ao Lume.');
    } catch(error) { res.writeHead(400); res.end('Não foi possível conectar. Volte ao Lume para tentar novamente.'); onError(error); }
    finally { close(); }
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  function close() { clearTimeout(timer); server.close(); }
  timer=setTimeout(()=>{close();onError(new Error('O login expirou. Tente novamente.'));},milliseconds); timer.unref?.();
  return {state, redirectUri:`http://127.0.0.1:${server.address().port}/oauth/callback`,close};
}
function within(root, relative, {mustExist=true, directory=false}={}) {
  if (typeof relative !== 'string' || !relative || relative.includes('\0') || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..') || relative.includes(':')) throw new Error('Caminho de documento inválido.');
  const base=fs.realpathSync(root), target=path.resolve(base, relative);
  if (!target.startsWith(base+path.sep)) throw new Error('O documento precisa permanecer na pasta escolhida.');
  const parts=path.relative(base,target).split(path.sep); let current=base;
  for (const part of parts) {
    current=path.join(current,part);
    if (fs.existsSync(current)) {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Atalhos e links simbólicos não são aceitos na pasta de documentos.');
      const real=fs.realpathSync(current); if (!real.startsWith(base+path.sep)) throw new Error('Documento fora da pasta escolhida.');
    } else if (mustExist) throw new Error('Documento não encontrado.');
  }
  if (mustExist && !(directory?fs.statSync(target).isDirectory():fs.statSync(target).isFile())) throw new Error('Tipo de documento inválido.');
  return target;
}
async function textResponse(response, {max=8*1024*1024}={}) {
  if (!response.ok) { const error=new Error(response.status===401?'A autorização expirou. Reconecte a integração.':response.status===403?'A integração não tem permissão para esta operação.':`O serviço retornou HTTP ${response.status}.`);error.status=response.status; throw error; }
  const length=Number(response.headers.get('content-length')); if (length>max) throw new Error('O documento ultrapassou o limite de tamanho.');
  const reader=response.body.getReader(); let bytes=0, parts=[];
  try { for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>max)throw new Error('A resposta ultrapassou o limite de tamanho.');parts.push(Buffer.from(value));} }
  finally { await reader.cancel().catch(()=>{}); }
  return Buffer.concat(parts).toString('utf8');
}
async function jsonResponse(response, options){return JSON.parse(await textResponse(response,options));}
module.exports={clip,object,remoteUrl,safeEqual,loopback,within,jsonResponse,textResponse};

async function consumeSSE(body, onEvent) {
  const decoder=new TextDecoder(); let pending='';
  function dispatch(block) {
    const data=block.replace(/\r\n/g,'\n').split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');
    if(!data || data==='[DONE]') return;
    let event; try { event=JSON.parse(data); } catch { throw new Error('O servidor retornou um evento inválido.'); }
    onEvent(event);
  }
  for await (const chunk of body) { pending+=decoder.decode(chunk,{stream:true}); let separator; while((separator=/\r?\n\r?\n/.exec(pending))!==null) {dispatch(pending.slice(0,separator.index));pending=pending.slice(separator.index+separator[0].length);} if(pending.length>32*1024*1024) throw new Error('Evento excedeu o limite de tamanho.'); }
  pending+=decoder.decode(); if(pending.trim()) dispatch(pending);
}
async function consumeNDJSON(body,onEvent) {
  const decoder=new TextDecoder(); let pending='';
  for await(const chunk of body) {pending+=decoder.decode(chunk,{stream:true});let index;while((index=pending.indexOf('\n'))!==-1){const line=pending.slice(0,index);pending=pending.slice(index+1);if(line.trim())onEvent(JSON.parse(line));} if(pending.length>16*1024*1024)throw new Error('Resposta local muito grande.');}
  pending+=decoder.decode();if(pending.trim())onEvent(JSON.parse(pending));
}
function responseFailure(code) {
  if (/subscription_sharing_usage_limit_exceeded|rate_limit/.test(code)) return 'Você atingiu o limite de uso da conta. Confira o uso nas configurações do ChatGPT e tente mais tarde.';
  if (/subscription_sharing_usage_unavailable/.test(code)) return 'O uso do plano não está disponível para esta conta ou workspace. Confira a autorização no ChatGPT.';
  return `A resposta não foi concluída (${String(code||'erro desconhecido').slice(0,100)}).`;
}
module.exports={consumeSSE,consumeNDJSON,responseFailure};

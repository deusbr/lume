const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs');
const {SessionService}=require('../lib/session-service.cjs');

const sse=events=>new Response(events.map(event=>`data: ${JSON.stringify(event)}\n\n`).join(''),{headers:{'content-type':'text/event-stream'}});
const answer=value=>sse([{type:'response.output_text.delta',delta:value},{type:'response.completed',response:{output:[]}}]);
const toolCall=(name,args={},id='call-fixture')=>sse([{type:'response.completed',response:{output:[{type:'function_call',name,arguments:JSON.stringify(args),call_id:id,id:`fc-${id}`} ]}}]);
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
async function until(condition,message='Condition did not settle'){const deadline=Date.now()+4000;while(!condition()){if(Date.now()>deadline)throw Error(message);await new Promise(resolve=>setTimeout(resolve,5));}}
function fixture(t,{outputs=[],fetchImpl,audio:audioOverride,integration:integrationOverride}={}){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'lume-session-test-')),store=new Store(directory),events=[],requests=[],changed=[],audioCalls=[];store.setProfile('alice');store.settings({provider:'chatgpt',model:'fixture-model',followUpsEnabled:false,autoCompact:false});
  const audio={pause:async value=>{audioCalls.push({method:'pause',value});},resume:async()=>{audioCalls.push({method:'resume'});},stop:async input=>{audioCalls.push({method:'stop',input});},speak:async input=>{audioCalls.push({method:'speak',input});return {speaking:true,speechId:'fixture-speech'};},...audioOverride};
  const integration={toolDefinitions:async()=>[],executeTool:async()=>{throw Error('No external fixture tools configured.');},...integrationOverride};
  const service=new SessionService({store,audio,integration,auth:{status:()=>({profiles:[{id:store.profileId,connected:true,planEnabled:true}]}),access:async profile=>`fixture-token-${profile}`},localEngine:{generate:async()=>{throw Error('No model execution in this fixture.');}},emit:event=>events.push(event),changed:id=>changed.push(id),fetchImpl:async(url,options)=>{const body=JSON.parse(options.body);requests.push(body);if(fetchImpl)return fetchImpl(url,options,body,requests.length);const next=outputs.shift();if(next instanceof Error)throw next;return typeof next==='function'?next(url,options,body):answer(next??'Resposta simulada.');}});
  t.after(async()=>{service.dispose();await until(()=>!service.jobs.size&&!service.backgroundRunning,'Fixture jobs did not stop');store.close();fs.rmSync(directory,{recursive:true,force:true});});
  return {directory,store,service,events,requests,changed,audio,audioCalls};
}
const requestPrompt=request=>request.input.filter(x=>x.role==='user').flatMap(x=>x.content||[]).map(x=>x.text||'').join('\n');

test('screen insights require opt-in and background tasks retain prompts after compaction',async t=>{
 const f=fixture(t,{outputs:['Primeiro insight','Segundo insight']}),s=f.store.createSession({title:'Tela'});let captures=0;f.service.screenContext=async()=>{captures++;return {kind:'image',name:'Tela',data:'data:image/png;base64,ZmFrZQ=='};};f.store.updateSession(s.id,{compaction:{cutoff:35,summary:'Contexto preservado'}});
 await f.service.insight({sessionId:s.id});assert.equal(captures,0);assert.match(requestPrompt(f.requests[0]),/Gatilho: manual/);
 f.store.settings({insightTriggers:{screen:true}});await f.service.insight({sessionId:s.id});assert.equal(captures,1);assert.ok(f.requests[1].input[0].content.some(c=>c.type==='input_image'));
});

test('local web search refuses unsupported research instead of silently fabricating sources',async t=>{
 const f=fixture(t),s=f.store.createSession({title:'Local'});f.store.settings({provider:'local',localModel:'fixture',webSearch:true});await assert.rejects(f.service.generate({session:s,profileId:f.store.profileId}),/Pesquisa web indisponível/);assert.equal(f.requests.length,0);
});

test('session summary and rewrite persist grounded JSON output without deleting conversation or transcript',async t=>{
  const f=fixture(t,{outputs:[JSON.stringify({subject:'Decisões do projeto',markdown:'- Entrega na sexta.'}),JSON.stringify({subject:'Próximos passos',markdown:'- Confirmar a entrega.'})]}),s=f.store.createSession({title:'Reunião'});
  f.store.message(s.id,{role:'user',content:'A entrega será na sexta-feira.'});f.store.transcript(s.id,{text:'Confirmar a data com a equipe.',speaker:'Outro lado'});const original=f.store.session(s.id);
  const summary=await f.service.summary({id:s.id});assert.equal(summary.markdown,'- Entrega na sexta.');assert.equal(f.store.session(s.id).summary.subject,'Decisões do projeto');assert.match(requestPrompt(f.requests[0]),/sexta-feira/);assert.match(requestPrompt(f.requests[0]),/Confirmar a data/);
  const rewritten=await f.service.summary({id:s.id,instruction:'Destaque somente ações pendentes.'});assert.equal(rewritten.subject,'Próximos passos');assert.match(requestPrompt(f.requests[1]),/Destaque somente ações/);assert.match(requestPrompt(f.requests[1]),/Resumo anterior: - Entrega na sexta/);assert.deepEqual(f.store.session(s.id).messages,original.messages);assert.deepEqual(f.store.session(s.id).transcripts,original.transcripts);assert.equal(f.events.filter(e=>e.type==='summary').length,2);
});

test('compaction can be undone and all original messages remain in SQLite',async t=>{
  const f=fixture(t,{outputs:['Fatos importantes preservados.']}),s=f.store.createSession({title:'Longa conversa'});for(let i=0;i<28;i++)f.store.message(s.id,{role:i%2?'assistant':'user',content:`Mensagem original ${i}`});const original=f.store.session(s.id).messages;
  const compacted=await f.service.compact(s.id);assert.equal(compacted.cutoff,8);assert.equal(compacted.summary,'Fatos importantes preservados.');assert.deepEqual(f.store.session(s.id).messages,original);assert.match(requestPrompt(f.requests[0]),/Mensagem original 0/);assert.doesNotMatch(requestPrompt(f.requests[0]),/Mensagem original 27/);
  f.store.updateSession(s.id,{compaction:null});assert.equal(f.store.session(s.id).compaction,null);assert.deepEqual(f.store.session(s.id).messages,original);
});

test('memory retrieval returns only the active profile and excludes failed or interrupted answers',async t=>{
  const f=fixture(t,{outputs:['A decisão foi validar o projeto [S1].']}),alice=f.store.createSession({title:'Projeto Alice'});f.store.message(alice.id,{role:'user',content:'Projeto: validar o aplicativo.'});f.store.message(alice.id,{role:'assistant',content:'FALSE_FAILED_ANSWER',status:'failed'});f.store.message(alice.id,{role:'assistant',content:'FALSE_INTERRUPTED_ANSWER',status:'interrupted'});
  f.store.setProfile('bob');const bob=f.store.createSession({title:'Projeto Bob privado'});f.store.message(bob.id,{role:'user',content:'BOB_PRIVATE_INFORMATION'});f.store.setProfile('alice');const result=await f.service.memoryAsk({question:'Qual decisão do projeto?'});assert.ok(result.sources.some(x=>x.id===alice.id));assert.equal(result.sources.some(x=>x.id===bob.id),false);assert.doesNotMatch(f.requests[0].instructions,/BOB_PRIVATE_INFORMATION/);assert.doesNotMatch(f.requests[0].instructions,/FALSE_FAILED_ANSWER|FALSE_INTERRUPTED_ANSWER/);
});

test('empty memory does not request a model or use another profile as a fallback',async t=>{
  const f=fixture(t);f.store.createSession({title:'Privado Alice'});f.store.setProfile('empty');const result=await f.service.memoryAsk({question:'Qual foi a decisão?'});assert.equal(result.sources.length,0);assert.match(result.answer,/Nenhuma sessão/);assert.equal(f.requests.length,0);
});

test('translation can be retried after an error and clears the obsolete error state',async t=>{
  const f=fixture(t,{outputs:[Error('Falha temporária simulada.'),'Good morning.']}),s=f.store.createSession({title:'Tradução'}),transcript=f.store.transcript(s.id,{text:'Bom dia.',speaker:'Você',source:'microphone'});
  await assert.rejects(f.service.translate({sessionId:s.id,transcriptId:transcript.id,language:'en'}),/temporária/);assert.equal(f.store.session(s.id).transcripts[0].translationStatus,'failed');
  const retry=await f.service.translate({sessionId:s.id,transcriptId:transcript.id,language:'en'});assert.equal(retry.translation,'Good morning.');assert.equal(retry.translationStatus,'completed');assert.ok(!retry.translationError);assert.match(requestPrompt(f.requests[1]),/inglês/);
});

test('late generation after a profile switch becomes interrupted in its original profile and never contaminates the new one',async t=>{
  const gate=deferred(),started=deferred();const f=fixture(t,{fetchImpl:async()=>{started.resolve();return gate.promise;}}),s=f.store.createSession({title:'Alice'});await f.service.send({sessionId:s.id,content:'Aguarde a resposta.'});await started.promise;
  f.service.profileChanged();f.store.setProfile('bob');gate.resolve(answer('Late Alice answer'));await until(()=>!f.service.jobs.size);assert.equal(f.store.stats().sessions,0);const original=f.store.forProfile('alice').session(s.id);assert.equal(original.messages.at(-1).status,'interrupted');assert.equal(f.events.some(e=>e.type==='completed'&&e.profileId==='bob'),false);
});

test('late background summary after a profile switch cannot overwrite the active account',async t=>{
  const gate=deferred(),started=deferred();const f=fixture(t,{fetchImpl:async()=>{started.resolve();return gate.promise;}}),s=f.store.createSession({title:'Alice'}),pending=f.service.summary({id:s.id});await started.promise;f.service.profileChanged();f.store.setProfile('bob');gate.resolve(answer('{"subject":"Late","markdown":"Must not save"}'));await assert.rejects(pending,/perfil|interrompida/);assert.equal(f.store.stats().sessions,0);assert.equal(f.store.forProfile('alice').session(s.id).summary.markdown,'');
});

test('background queue runs only one task at a time, deduplicates keys, and skips cancelled queued work',async t=>{
  const f=fixture(t),gate=deferred(),order=[];let running=0,max=0;const first=async()=>{running++;max=Math.max(max,running);order.push('start-first');await gate.promise;order.push('end-first');running--;};const second=async()=>{running++;max=Math.max(max,running);order.push('second');running--;};
  f.service.enqueue('summary:first','alice',first);f.service.enqueue('summary:first','alice',()=>{throw Error('Duplicate must not run.');});f.service.enqueue('translation:second','alice',second);f.service.enqueue('insight:cancel-me','alice',()=>{order.push('cancelled-work-ran');});f.service.stop('cancel-me');assert.equal(f.service.background.size,3);gate.resolve();await until(()=>!f.service.backgroundRunning);assert.equal(max,1);assert.deepEqual(order,['start-first','end-first','second']);assert.equal(f.service.background.size,0);
});

test('voice microphone transcript follows normal chat, pauses capture, speaks the completed answer and resumes only for its session/profile',async t=>{
  const f=fixture(t,{outputs:['Resposta por voz.']}),s=f.store.createSession({title:'Voz'});f.store.settings({voiceMode:true});await f.service.transcriptFinal({profileId:'alice',sessionId:s.id,item:{id:'mic-final-1',text:'Qual é a próxima etapa?',speaker:'Você',source:'microphone'}});await until(()=>!f.service.jobs.size);
  assert.equal(f.store.session(s.id).messages[0].role,'user');assert.equal(f.store.session(s.id).messages[0].content,'Qual é a próxima etapa?');assert.equal(f.store.session(s.id).messages[1].status,'completed');assert.equal(f.audioCalls[0].method,'pause');assert.equal(f.audioCalls[0].value,true);const speech=f.audioCalls.find(x=>x.method==='speak');assert.equal(speech.input.text,'Resposta por voz.');assert.equal(speech.input.sessionId,s.id);
  f.service.speechEnded({profileId:'bob',sessionId:s.id});f.service.speechEnded({profileId:'alice',sessionId:'different-session'});assert.equal(f.audioCalls.filter(x=>x.method==='pause'&&x.value===false).length,0);f.service.speechEnded({profileId:'alice',sessionId:s.id,speechId:'fixture-speech'});assert.equal(f.audioCalls.filter(x=>x.method==='pause'&&x.value===false).length,1);
});

test('system-only transcript does not trigger conversational voice',async t=>{
  const f=fixture(t),s=f.store.createSession({title:'Sistema'});f.store.settings({voiceMode:true});await f.service.transcriptFinal({profileId:'alice',sessionId:s.id,item:{id:'system-final-1',text:'Áudio do outro lado.',source:'system',speaker:'Outro lado'}});assert.equal(f.store.session(s.id).transcripts.length,1);assert.equal(f.store.session(s.id).messages.length,0);assert.equal(f.requests.length,0);assert.equal(f.audioCalls.length,0);
});

test('TTS failure preserves the already completed chat response and restores capture',async t=>{
  const f=fixture(t,{outputs:['Resposta válida mesmo sem voz.'],audio:{speak:async()=>{throw Error('Voz indisponível.');}}}),s=f.store.createSession({title:'Falha de voz'});f.store.settings({voiceMode:true});await f.service.transcriptFinal({profileId:'alice',sessionId:s.id,item:{id:'mic-final-fail',text:'Pergunta para testar.',source:'microphone',speaker:'Você'}});await until(()=>!f.service.jobs.size);const message=f.store.session(s.id).messages.at(-1);assert.equal(message.status,'completed');assert.equal(message.content,'Resposta válida mesmo sem voz.');assert.ok(f.events.some(e=>e.type==='audio-error'));assert.ok(f.audioCalls.some(x=>x.method==='pause'&&x.value===false));
});

test('namespace memory tools cannot read another profile and external pending approvals preserve identifiers',async t=>{
  let executed;const f=fixture(t,{outputs:[()=>toolCall('lume.lume_fixture_note_write',{path:'note.md',text:'Proposal'}), 'A gravação aguarda sua aprovação.'],integration:{toolDefinitions:async()=>[{type:'function',name:'lume_fixture_note_write',description:'Propose note',parameters:{type:'object'},strict:false}],executeTool:async input=>{executed=input;return {pendingApproval:true,approvalId:'fixture-approval'};}}}),s=f.store.createSession({title:'Ferramentas'});
  await f.service.send({sessionId:s.id,content:'Prepare uma nota.'});await until(()=>!f.service.jobs.size);assert.equal(executed.name,'lume_fixture_note_write');assert.equal(executed.sessionId,s.id);assert.ok(executed.requestId);assert.equal(executed.signal.aborted,false);assert.equal(f.requests[0].tools[0].name,'lume');const functionOutput=f.requests[1].input.find(x=>x.type==='function_call_output');assert.equal(JSON.parse(functionOutput.output).pendingApproval,true);
  f.store.setProfile('bob');const privateSession=f.store.createSession({title:'Privado Bob'});f.store.message(privateSession.id,{content:'BOB_SECRET'});f.store.setProfile('alice');f.service.fetchImpl=async()=>toolCall('lume.memory_read_session',{id:privateSession.id});await assert.rejects(f.service.generate({profileId:'alice',session:f.store.session(s.id),useTools:true}),/perfil|encontrada/);
});

test('ending during a profile change never mutates the new account and returns a controlled profile error',async t=>{
  const gate=deferred(),started=deferred();const f=fixture(t,{audio:{stop:async()=>{started.resolve();await gate.promise;}}}),s=f.store.createSession({title:'Fim Alice'});const pending=f.service.end({id:s.id,summary:false});await started.promise;f.service.profileChanged();f.store.setProfile('bob');gate.resolve();await assert.rejects(pending,/perfil|mudou/);assert.equal(f.store.stats().sessions,0);assert.equal(f.store.forProfile('alice').session(s.id).status,'active');
});

test('memory_read_session tool returns only completed answers from the requested active-profile session',async t=>{
  const f=fixture(t),s=f.store.createSession({title:'Memória válida'});f.store.message(s.id,{role:'user',content:'Fato confirmado.'});f.store.message(s.id,{role:'assistant',content:'CONFIRMED_ANSWER',status:'completed'});f.store.message(s.id,{role:'assistant',content:'FAILED_MEMORY_MUST_NOT_RETURN',status:'failed'});f.store.message(s.id,{role:'assistant',content:'INTERRUPTED_MEMORY_MUST_NOT_RETURN',status:'interrupted'});let round=0,captured;
  f.service.fetchImpl=async(_url,options)=>{round++;const request=JSON.parse(options.body);if(round===1)return toolCall('lume.memory_read_session',{id:s.id});captured=JSON.parse(request.input.find(x=>x.type==='function_call_output').output);return answer('Resposta fundamentada.');};
  await f.service.generate({session:f.store.session(s.id),profileId:'alice',useTools:true});assert.equal(captured.messages.length,2);assert.ok(captured.messages.some(m=>m.content==='CONFIRMED_ANSWER'));assert.equal(JSON.stringify(captured).includes('FAILED_MEMORY_MUST_NOT_RETURN'),false);assert.equal(JSON.stringify(captured).includes('INTERRUPTED_MEMORY_MUST_NOT_RETURN'),false);
});

test('a stale connector tool not offered in this request cannot execute even if a previous mapping exists',async t=>{
  let executed=0;const f=fixture(t,{outputs:[()=>toolCall('lume.lume_stale_connection_write',{text:'Must not execute'}),'Should never reach this answer.'],integration:{toolDefinitions:async()=>[],executeTool:async()=>{executed++;return {content:'This tool was not offered'};}}}),s=f.store.createSession({title:'Seleção de ferramentas'});
  await assert.rejects(f.service.generate({session:s,profileId:'alice',useTools:true}),/ferramenta|autorizad|oferecid/i);assert.equal(executed,0);
});

test('a completed function call from an unrelated namespace cannot reach Lume memory',async t=>{
  const f=fixture(t),s=f.store.createSession({title:'Namespace Lume'});f.service.fetchImpl=async()=>sse([{type:'response.completed',response:{output:[{type:'function_call',name:'memory_read_session',namespace:'foreign_namespace',call_id:'foreign-call',arguments:JSON.stringify({id:s.id})}]}}]);
  await assert.rejects(f.service.generate({session:s,profileId:'alice',useTools:true}),/namespace|espaço|ferramenta|autorizad/i);
});

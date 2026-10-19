const path=require('node:path');const {spawn}=require('node:child_process');
// Fixed program. User text is JSON on stdin and is never interpolated into shell code.
const PROGRAM=String.raw`
$ErrorActionPreference='Stop'
[Console]::InputEncoding=[Text.Encoding]::UTF8
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
try {
 $request=[Console]::ReadLine() | ConvertFrom-Json
 Add-Type -AssemblyName System.Speech
 $synth=New-Object System.Speech.Synthesis.SpeechSynthesizer
 if ($request.command -eq 'voices') {
  $voices=@($synth.GetInstalledVoices() | Where-Object {$_.Enabled} | ForEach-Object {@{name=$_.VoiceInfo.Name;language=$_.VoiceInfo.Culture.Name;gender=$_.VoiceInfo.Gender.ToString();localService=$true}})
  [Console]::WriteLine((@{type='voices';voices=$voices} | ConvertTo-Json -Compress -Depth 4))
 } elseif ($request.command -eq 'speak') {
  $text=[string]$request.text
  if ($text.Length -gt 20000) {throw 'Texto de voz muito longo.'}
  $voices=@($synth.GetInstalledVoices() | Where-Object {$_.Enabled})
  if ($voices.Count -eq 0) {throw 'Nenhuma voz local do Windows está instalada.'}
  $chosen=$voices | Where-Object {$_.VoiceInfo.Name -eq $request.voice} | Select-Object -First 1
  if (-not $chosen -and $request.language) {$lang=([string]$request.language).Split('-')[0];$chosen=$voices | Where-Object {$_.VoiceInfo.Culture.Name.StartsWith($lang,[StringComparison]::OrdinalIgnoreCase)} | Select-Object -First 1}
  if ($chosen) {$synth.SelectVoice($chosen.VoiceInfo.Name)}
  $stream=$null
  if ($request.silentFixture -eq $true) {$stream=New-Object IO.MemoryStream;$synth.SetOutputToWaveStream($stream)}
  [Console]::WriteLine((@{type='speaking';speechId=$request.speechId} | ConvertTo-Json -Compress))
  $synth.Speak($text)
  [Console]::WriteLine((@{type='speech-ended';speechId=$request.speechId;cancelled=$false;error=$null;fixtureBytes=$(if($stream){$stream.Length}else{0})} | ConvertTo-Json -Compress))
  if($stream){$stream.Dispose()}
 } else {throw 'Comando de voz inválido.'}
 $synth.Dispose()
} catch {[Console]::WriteLine((@{type='speech-error';error=$_.Exception.Message;speechId=$request.speechId} | ConvertTo-Json -Compress));exit 1}
`;
class WindowsSpeech{
 constructor({onEvent=()=>{}}={}){this.onEvent=onEvent;this.running=null;}
 spawn(command){if(process.platform!=='win32')throw new Error('A voz local do Windows não está disponível neste sistema.');const executable=path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');const child=spawn(executable,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(PROGRAM,'utf16le').toString('base64')],{windowsHide:true,stdio:['pipe','pipe','pipe']});child.stdin.end(JSON.stringify(command)+'\n');child.stderr.on('data',()=>{});return child;}
 voices(){return new Promise((resolve,reject)=>{let child;try{child=this.spawn({command:'voices'});}catch(e){reject(e);return;}let buffer='',done=false;const timer=setTimeout(()=>{child.kill();reject(new Error('O catálogo de vozes do Windows não respondeu.'));},15000);child.stdout.on('data',d=>{buffer+=d.toString('utf8');if(buffer.length>100000){child.kill();return;}for(const line of buffer.split(/\r?\n/).slice(0,-1)){try{const e=JSON.parse(line);if(e.type==='voices'){done=true;clearTimeout(timer);resolve(e.voices);}else if(e.type==='speech-error'){clearTimeout(timer);reject(new Error(e.error));}}catch{}}buffer=buffer.slice(buffer.lastIndexOf('\n')+1);});child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',()=>{clearTimeout(timer);if(!done)reject(new Error('Não foi possível consultar as vozes locais do Windows.'));});});}
 speak({text,language='pt-BR',voice='',speechId,silentFixture=false}){this.stop();return new Promise((resolve,reject)=>{let child;try{child=this.spawn({command:'speak',text,language,voice,speechId,silentFixture});}catch(e){reject(e);return;}const record={child,speechId,started:false,finished:false};this.running=record;let buffer='';const timer=setTimeout(()=>{if(!record.started){child.kill();reject(new Error('A voz local do Windows não iniciou.'));}},15000);child.stdout.on('data',d=>{buffer+=d.toString('utf8');let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);let e;try{e=JSON.parse(line);}catch{continue;}if(e.type==='speaking'){record.started=true;clearTimeout(timer);resolve({speaking:true,speechId,backend:'windows-speech'});}else if(e.type==='speech-ended'){record.finished=true;if(this.running===record)this.running=null;this.onEvent(e);}else if(e.type==='speech-error'){clearTimeout(timer);record.finished=true;if(this.running===record)this.running=null;if(!record.started)reject(new Error(e.error));else this.onEvent({type:'speech-ended',speechId,error:e.error,cancelled:false});}}});child.once('error',e=>{clearTimeout(timer);if(this.running===record)this.running=null;reject(e);});child.once('exit',code=>{clearTimeout(timer);if(this.running===record)this.running=null;if(!record.started)reject(new Error('O Windows não permitiu iniciar a voz local.'));else if(!record.finished){record.finished=true;this.onEvent({type:'speech-ended',speechId,cancelled:!!record.cancelled,error:record.cancelled?null:`A leitura local foi interrompida (${code}).`});}});});}
 stop(){const record=this.running;if(!record)return;this.running=null;record.cancelled=true;record.child.kill();if(!record.finished){record.finished=true;this.onEvent({type:'speech-ended',speechId:record.speechId,cancelled:true,error:null});}}
 dispose(){this.stop();}
}
module.exports={WindowsSpeech};

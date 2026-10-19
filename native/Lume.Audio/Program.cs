using System.Text.Json;
using NAudio.CoreAudioApi;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;
using System.Speech.Synthesis;

sealed class MonoSamples(ISampleProvider input) : ISampleProvider {
 public WaveFormat WaveFormat {get;}=WaveFormat.CreateIeeeFloatWaveFormat(input.WaveFormat.SampleRate,1);
 public int Read(float[] buffer,int offset,int count){var channels=input.WaveFormat.Channels;var temp=new float[count*channels];var n=input.Read(temp,0,temp.Length)/channels;for(var i=0;i<n;i++){float sum=0;for(var c=0;c<channels;c++)sum+=temp[i*channels+c];buffer[offset+i]=sum/channels;}return n;}
}
sealed class Capture : IDisposable {
 public readonly WasapiCapture Device; public readonly string CaptureId; public bool Paused;
 readonly BufferedWaveProvider buffer;readonly ISampleProvider samples;readonly Action<object> emit; readonly string source;
 public Capture(MMDevice device,bool loopback,string captureId,string source,Action<object> emit){this.emit=emit;this.source=source;CaptureId=captureId;Device=loopback?new WasapiLoopbackCapture(device):new WasapiCapture(device);buffer=new BufferedWaveProvider(Device.WaveFormat){DiscardOnBufferOverflow=true,ReadFully=false,BufferDuration=TimeSpan.FromSeconds(3)};samples=new WdlResamplingSampleProvider(new MonoSamples(buffer.ToSampleProvider()),16000);Device.DataAvailable+=Data;Device.RecordingStopped+=(_,e)=>{if(e.Exception!=null)emit(new{type="capture-error",captureId,source,error=e.Exception.Message});};Device.StartRecording();}
 void Data(object? sender,WaveInEventArgs e){if(Paused)return;try{buffer.AddSamples(e.Buffer,0,e.BytesRecorded);var floats=new float[8192];int n;while((n=samples.Read(floats,0,floats.Length))>0){var pcm=new byte[n*2];double energy=0;for(var i=0;i<n;i++){var value=Math.Clamp(floats[i],-1,1);energy+=value*value;var s=(short)(value*32767);pcm[i*2]=(byte)s;pcm[i*2+1]=(byte)(s>>8);}emit(new{type="audio",captureId=CaptureId,source,pcm=Convert.ToBase64String(pcm),level=Math.Sqrt(energy/n),sampleRate=16000});}}catch(Exception ex){emit(new{type="capture-error",captureId=CaptureId,source,error=ex.Message});}}
 public void Dispose(){Device.DataAvailable-=Data;try{Device.StopRecording();}catch{}Device.Dispose();}
}
static class Program {
 static readonly object outputLock=new();static readonly Dictionary<string,Capture> captures=new();static readonly SpeechSynthesizer speech=new(); static readonly System.Collections.Concurrent.ConcurrentDictionary<Prompt,string> speechIds=new();
 static void Emit(object obj){lock(outputLock){Console.WriteLine(JsonSerializer.Serialize(obj));Console.Out.Flush();}}
 static string Text(JsonElement v,string key,string fallback="")=>v.TryGetProperty(key,out var p)?p.GetString()??fallback:fallback;
 static bool Flag(JsonElement v,string key)=>v.TryGetProperty(key,out var p)&&p.GetBoolean();
 static object Devices(){using var en=new MMDeviceEnumerator();return new{microphones=en.EnumerateAudioEndPoints(DataFlow.Capture,DeviceState.Active).Select(d=>new{id=d.ID,name=d.FriendlyName}).ToArray(),outputs=en.EnumerateAudioEndPoints(DataFlow.Render,DeviceState.Active).Select(d=>new{id=d.ID,name=d.FriendlyName}).ToArray()};}
 static void Stop(string source){if(captures.Remove(source,out var c))c.Dispose();}
 static void Main(string[] args){using var silentFixture=args.Contains("--silent-test")?new MemoryStream():null;if(silentFixture!=null)speech.SetOutputToWaveStream(silentFixture);Console.InputEncoding=System.Text.Encoding.UTF8;Console.OutputEncoding=new System.Text.UTF8Encoding(false);speech.SpeakCompleted+=(_,e)=>{speechIds.TryRemove(e.Prompt,out var speechId);Emit(new{type="speech-ended",speechId,cancelled=e.Cancelled,error=e.Error?.Message});};Emit(new{type="ready",version=1});string? line;while((line=Console.ReadLine())!=null){string id="";try{if(line.Length>100000)throw new Exception("Comando excedeu o limite.");using var json=JsonDocument.Parse(line);var cmd=json.RootElement;id=Text(cmd,"id");object? result=null;switch(Text(cmd,"command")){
 case "devices":result=Devices();break;
 case "start":{var source=Text(cmd,"source");if(source!="microphone"&&source!="system")throw new Exception("Fonte inválida.");Stop(source);using var en=new MMDeviceEnumerator();var deviceId=Text(cmd,"deviceId");var device=string.IsNullOrEmpty(deviceId)?en.GetDefaultAudioEndpoint(source=="system"?DataFlow.Render:DataFlow.Capture,Role.Multimedia):en.GetDevice(deviceId);captures[source]=new Capture(device,source=="system",Text(cmd,"captureId"),source,Emit);result=new{started=true};break;}
 case "stop":{var source=Text(cmd,"source");if(source=="")foreach(var key in captures.Keys.ToArray())Stop(key);else Stop(source);break;}
 case "pause":foreach(var c in captures.Values)c.Paused=Flag(cmd,"paused");break;
 case "voices":result=speech.GetInstalledVoices().Where(v=>v.Enabled).Select(v=>new{name=v.VoiceInfo.Name,language=v.VoiceInfo.Culture.Name,gender=v.VoiceInfo.Gender.ToString()}).ToArray();break;
 case "speak":{speech.SpeakAsyncCancelAll();var text=Text(cmd,"text");if(text.Length>20000)throw new Exception("Texto de voz muito longo.");var voice=Text(cmd,"voice");var language=Text(cmd,"language");if(voice!="")speech.SelectVoice(voice);else if(language!="")speech.SelectVoiceByHints(VoiceGender.NotSet,VoiceAge.NotSet,0,System.Globalization.CultureInfo.GetCultureInfo(language));var prompt=new Prompt(text);var speechId=Text(cmd,"speechId");speechIds[prompt]=speechId;speech.SpeakAsync(prompt);result=new{speaking=true,speechId};break;}
 case "stopSpeaking":speech.SpeakAsyncCancelAll();break;
 default:throw new Exception("Comando desconhecido.");}
 Emit(new{type="result",id,result});}catch(Exception ex){Emit(new{type="result",id,error=ex.Message});}}
 foreach(var c in captures.Values)c.Dispose();speech.Dispose();}
}

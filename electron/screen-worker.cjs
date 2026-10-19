/** Serial capture service. Electron requires desktopCapturer on its main thread. */
class ScreenCaptureWorker {
  constructor({desktopCapturer,emit=()=>{},timeout=15000}){this.capturer=desktopCapturer;this.emit=emit;this.timeout=timeout;this.pending=null;this.queued=0;this.generation=0;this.disposed=false;this.metrics={completed:0,failed:0,timeouts:0};}
  async sources(input={}){
    if(this.disposed)throw Error('Captura encerrada.');
    if(this.queued>=3)throw Error('A fila de captura está cheia.');
    this.queued++;const previous=this.pending;let release;const gate=new Promise(r=>release=r);this.pending=gate;
    try{if(previous)await previous;if(this.disposed)throw Error('Captura encerrada.');const generation=this.generation;let timer;const started=Date.now();
      const result=await Promise.race([this.capturer.getSources({types:input.types?.filter(t=>['screen','window'].includes(t))?.length?input.types.filter(t=>['screen','window'].includes(t)):['screen','window'],thumbnailSize:{width:1600,height:1000},fetchWindowIcons:true}),new Promise((_,reject)=>{timer=setTimeout(()=>{this.metrics.timeouts++;reject(Error('A captura demorou demais. Tente novamente.'));},this.timeout);})]).finally(()=>clearTimeout(timer));
      if(this.disposed||generation!==this.generation)throw Error('Captura interrompida; tente novamente.');this.metrics.completed++;this.emit({type:'capture-state',state:'completed',durationMs:Date.now()-started});return result.filter(s=>!/^Lume(?: ·|$)/.test(s.name)).map(s=>({id:s.id,name:s.name,displayId:s.display_id,image:s.thumbnail.toDataURL()}));
    }catch(e){this.metrics.failed++;this.emit({type:'capture-state',state:'failed',error:e.message});throw e;}finally{this.queued--;release();if(this.pending===gate)this.pending=null;}
  }
  recover(){this.generation++;this.emit({type:'capture-state',state:'recovered'});}
  dispose(){this.disposed=true;this.recover();}
  snapshot(){return {queued:this.queued,...this.metrics};}
}
module.exports={ScreenCaptureWorker};

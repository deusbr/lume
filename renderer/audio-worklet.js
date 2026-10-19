class LumeCapture extends AudioWorkletProcessor {
  constructor(){super();this.buffer=new Float32Array(4096);this.offset=0;}
  process(inputs){const input=inputs[0];if(!input?.length)return true;const frames=input[0].length;for(let i=0;i<frames;i++){let value=0;for(const channel of input)value+=channel[i]||0;this.buffer[this.offset++]=Math.max(-1,Math.min(1,value/input.length));if(this.offset===this.buffer.length){this.port.postMessage(this.buffer);this.buffer=new Float32Array(4096);this.offset=0;}}return true;}
}
registerProcessor('lume-capture',LumeCapture);

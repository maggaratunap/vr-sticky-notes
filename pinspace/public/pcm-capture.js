/* 16 kHz mono signed PCM, 250 ms packets. No local monitoring. */
class PinspaceCapture extends AudioWorkletProcessor {
 constructor(){super();this.phase=0;this.sum=0;this.count=0;this.buffer=new Int16Array(4000);this.offset=0;}
 process(inputs){const input=inputs[0]?.[0];if(!input)return true;for(const value of input){this.sum+=value;this.count++;this.phase+=16000;if(this.phase>=sampleRate){this.phase-=sampleRate;const v=Math.max(-1,Math.min(1,this.sum/this.count));this.buffer[this.offset++]=Math.round(v*(v<0?32768:32767));this.sum=0;this.count=0;if(this.offset===4000){const bytes=this.buffer.buffer;this.port.postMessage(bytes,[bytes]);this.buffer=new Int16Array(4000);this.offset=0;}}}return true;}
}
registerProcessor('pinspace-capture',PinspaceCapture);

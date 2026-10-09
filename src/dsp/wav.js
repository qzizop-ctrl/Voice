// ترميز WAV 16-bit ستيريو
export function toWav(ab, target){
  var n=ab.length,ch=2,sr=ab.sampleRate,L=ab.getChannelData(0),R=ab.numberOfChannels>1?ab.getChannelData(1):L,pk=0;
  for(var i=0;i<n;i++){var a=Math.abs(L[i]),b=Math.abs(R[i]);if(a>pk)pk=a;if(b>pk)pk=b}
  var g=target&&pk>0?target/pk:(pk>0.95?0.95/pk:1),bytes=44+n*4,u=new Uint8Array(bytes),v=new DataView(u.buffer);
  function str(o,t){for(var i=0;i<t.length;i++)v.setUint8(o+i,t.charCodeAt(i))}
  str(0,'RIFF');v.setUint32(4,bytes-8,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);
  v.setUint16(20,1,true);v.setUint16(22,ch,true);v.setUint32(24,sr,true);v.setUint32(28,sr*4,true);
  v.setUint16(32,4,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,n*4,true);
  for(var i=0,o=44;i<n;i++,o+=4){
    v.setInt16(o,Math.max(-1,Math.min(1,L[i]*g))*32767,true);
    v.setInt16(o+2,Math.max(-1,Math.min(1,R[i]*g))*32767,true);
  }
  return u;
}

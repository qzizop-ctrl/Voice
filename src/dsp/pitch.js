// كشف النغمة، الأوتوتيون، الهارموني (YIN + PSOLA مبسّط)
export function detect(x,sr){
  var sr2=sr/2,n2=Math.floor(x.length/2),y=new Float32Array(n2);
  for(var i=0;i<n2;i++)y[i]=(x[2*i]+x[2*i+1])*0.5;
  var W=640,hop=256,tmax=Math.floor(sr2/70),tmin=Math.floor(sr2/800);
  var F=Math.max(0,Math.floor((n2-W-tmax)/hop)),f0=new Float32Array(F),d=new Float32Array(tmax+1);
  for(var j=0;j<F;j++){
    var st=j*hop,e=0;
    for(var i=0;i<W;i++)e+=y[st+i]*y[st+i];
    if(Math.sqrt(e/W)<0.01){f0[j]=0;continue}
    for(var t=1;t<=tmax;t++){var sum=0;for(var i=0;i<W;i++){var q=y[st+i]-y[st+i+t];sum+=q*q}d[t]=sum}
    var run=0,tau=0;
    for(var t=1;t<=tmax;t++){run+=d[t];d[t]=d[t]*t/run}
    for(var t=tmin;t<tmax;t++){
      if(d[t]<0.15){while(t+1<tmax&&d[t+1]<d[t])t++;tau=t;break}
    }
    f0[j]=tau?sr2/tau:0;
  }
  return f0;
}
export function snap(f,allowed){
  var m=69+12*Math.log(f/440)/Math.LN2,r=Math.round(m),best=null,bd=99;
  for(var k=-3;k<=3;k++){var c=r+k;if(allowed[((c%12)+12)%12]){var dd=Math.abs(c-m);if(dd<bd){bd=dd;best=c}}}
  return best===null?0:best-m;
}
export function autotune(x,sr,key,scale,strength,speed){
  var allowed=[];for(var i=0;i<12;i++)allowed.push(false);
  scale.forEach(function(n){allowed[(n+key)%12]=true});
  var f0=detect(x,sr),F=f0.length,len=x.length;
  if(!F)return Float32Array.from(x);
  var shifts=new Float32Array(F),s=0;
  for(var j=0;j<F;j++){
    var tgt=f0[j]>0?snap(f0[j],allowed)*strength:0;
    s+=(tgt-s)*speed;shifts[j]=s;
  }
  return render(x,sr,f0,shifts);
}
export function render(x,sr,f0,shifts){
  var F=f0.length,len=x.length;
  function fi(pos){var j=Math.round((pos-640)/512);return Math.max(0,Math.min(F-1,j))}
  var U=Math.round(sr*0.008),marks=[],pos=Math.round(sr*0.01);
  while(pos<len-U*3){
    var j=fi(pos),P=f0[j]>0?sr/f0[j]:U;
    marks.push(pos);
    var nx=Math.round(pos+P);
    if(f0[j]>0){
      var lo=Math.max(0,Math.round(nx-P/4)),hi=Math.min(len-1,Math.round(nx+P/4)),bp=nx,bv=-9;
      for(var q=lo;q<=hi;q++){if(x[q]>bv){bv=x[q];bp=q}}
      nx=bp;
    }
    if(nx<=pos)nx=pos+1;
    pos=nx;
  }
  if(marks.length<3)return Float32Array.from(x);
  var out=new Float32Array(len),ws=new Float32Array(len),t=marks[0],idx=0;
  while(t<len-1){
    while(idx+1<marks.length&&Math.abs(marks[idx+1]-t)<=Math.abs(marks[idx]-t))idx++;
    var a=marks[idx];
    var Pa=idx+1<marks.length?marks[idx+1]-a:a-marks[idx-1];
    Pa=Math.max(Pa,20);
    var tr=Math.round(t);
    for(var i=-Pa;i<Pa;i++){
      var si=a+i,di=tr+i;
      if(si<0||si>=len||di<0||di>=len)continue;
      var w=0.5+0.5*Math.cos(Math.PI*i/Pa);
      out[di]+=x[si]*w;ws[di]+=w;
    }
    t+=Pa/Math.pow(2,shifts[fi(a)]/12);
  }
  for(var i=0;i<len;i++)if(ws[i]>0.2)out[i]/=ws[i];
  return out;
}

export function harmShifts(f0,allowed,k,speed,chromatic){
  var F=f0.length,sh=new Float32Array(F),s=0,map={'2':4,'4':7,'-2':-4,'7':12};
  for(var j=0;j<F;j++){
    var tgt=0;
    if(f0[j]>0){
      var m=69+12*Math.log(f0[j]/440)/Math.LN2,n=Math.round(m+snap(f0[j],allowed)),tn=n;
      if(chromatic){tn=n+map[String(k)]}
      else{var c=Math.abs(k),dir=k>0?1:-1,st=0;
        while(c>0&&st<48){tn+=dir;st++;if(allowed[((tn%12)+12)%12])c--}}
      tgt=tn-m;
    }
    s+=(tgt-s)*speed;sh[j]=s;
  }
  return sh;
}

export function makeAllowed(key,scale){
  const a=Array(12).fill(false);
  scale.forEach(n=>{a[(n+key)%12]=true});
  return a;
}

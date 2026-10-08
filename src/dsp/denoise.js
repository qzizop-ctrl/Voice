// تنقية الضوضاء بالطيف (Spectral subtraction)
function fft(re,im,inv){
  var n=re.length,j=0,i,k,t;
  for(i=1;i<n;i++){var bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;
    if(i<j){t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t}}
  for(var len=2;len<=n;len<<=1){
    var ang=2*Math.PI/len*(inv?1:-1),wr=Math.cos(ang),wi=Math.sin(ang),h=len>>1;
    for(i=0;i<n;i+=len){
      var cr=1,ci=0;
      for(k=0;k<h;k++){
        var a=i+k,b=a+h,tr=re[b]*cr-im[b]*ci,ti=re[b]*ci+im[b]*cr;
        re[b]=re[a]-tr;im[b]=im[a]-ti;re[a]+=tr;im[a]+=ti;
        var nr=cr*wr-ci*wi;ci=cr*wi+ci*wr;cr=nr;
      }
    }
  }
  if(inv)for(i=0;i<n;i++){re[i]/=n;im[i]/=n}
}
export function denoise(x,strength){
  var N=2048,H=512,B=N/2+1,len=x.length,pad=N,tot=len+2*pad;
  var nF=Math.floor((tot-N)/H)+1,win=new Float32Array(N);
  for(var i=0;i<N;i++)win[i]=Math.sqrt(0.5-0.5*Math.cos(2*Math.PI*i/N));
  var xp=new Float32Array(tot);xp.set(x,pad);
  var re=new Float32Array(N),im=new Float32Array(N),mags=new Float32Array(nF*B);
  function analyze(f){
    var o=f*H;for(var i=0;i<N;i++){re[i]=xp[o+i]*win[i];im[i]=0}
    fft(re,im,false);
  }
  for(var f=0;f<nF;f++){analyze(f);for(var k=0;k<B;k++)mags[f*B+k]=Math.sqrt(re[k]*re[k]+im[k]*im[k])}
  var stride=Math.max(1,Math.floor(nF/1200)),cnt=Math.floor(nF/stride),noise=new Float32Array(B),col=new Float32Array(cnt);
  for(var k=0;k<B;k++){
    for(var c=0;c<cnt;c++)col[c]=mags[c*stride*B+k];
    col.sort();noise[k]=col[Math.floor(cnt*0.1)];
  }
  var sm=new Float32Array(B);
  for(var k=0;k<B;k++){var a=noise[Math.max(0,k-2)],b=noise[k],c2=noise[Math.min(B-1,k+2)];sm[k]=(a+b*2+c2)/4}
  var alpha=1.5+strength*2.5,floor=0.02+(1-strength)*0.2;
  var prev=new Float32Array(B).fill(1),g=new Float32Array(B),out=new Float32Array(tot);
  for(var f=0;f<nF;f++){
    analyze(f);
    for(var k=0;k<B;k++){
      var m=mags[f*B+k]+1e-9,gk=Math.max(floor,(m-alpha*sm[k])/m);
      var r=gk>prev[k]?0.6:0.25;gk=prev[k]+(gk-prev[k])*r;prev[k]=gk;g[k]=gk;
    }
    for(var k=0;k<B;k++){
      var gs=(g[Math.max(0,k-1)]+g[k]*2+g[Math.min(B-1,k+1)])/4;
      re[k]*=gs;im[k]*=gs;
      if(k>0&&k<N/2){re[N-k]=re[k];im[N-k]=-im[k]}
    }
    im[0]=0;im[N/2]=0;
    fft(re,im,true);
    var o=f*H;for(var i=0;i<N;i++)out[o+i]+=re[i]*win[i]*0.5;
  }
  return out.slice(pad,pad+len);
}

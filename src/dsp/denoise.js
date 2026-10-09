// تنقية الضوضاء الثابتة: Wiener بتقدير "decision-directed" (بيقلل صوت المعدن/الفقاعات) + Gate للفراغات
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

export function denoise(x, strength) {
  const N = 2048, H = 512, B = N / 2 + 1, len = x.length, pad = N, tot = len + 2 * pad;
  const nF = Math.floor((tot - N) / H) + 1, win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  const xp = new Float32Array(tot);
  xp.set(x, pad);
  const re = new Float32Array(N), im = new Float32Array(N);
  const analyze = (f) => {
    const o = f * H;
    for (let i = 0; i < N; i++) { re[i] = xp[o + i] * win[i]; im[i] = 0; }
    fft(re, im, false);
  };
  // 1) قدّر طيف الضوضاء من أهدأ 20% من الإطارات
  const pw = new Float32Array(nF * B), en = new Float32Array(nF);
  for (let f = 0; f < nF; f++) {
    analyze(f);
    let e = 0;
    for (let k = 0; k < B; k++) { const p = re[k] * re[k] + im[k] * im[k]; pw[f * B + k] = p; e += p; }
    en[f] = e;
  }
  const order = Array.from(en.keys()).sort((a, b) => en[a] - en[b]);
  const q = Math.max(3, Math.floor(nF * 0.2)), noise = new Float32Array(B);
  for (let i = 0; i < q; i++) { const f = order[i]; for (let k = 0; k < B; k++) noise[k] += pw[f * B + k] / q; }
  const nz = new Float32Array(B);
  for (let k = 0; k < B; k++) nz[k] = (noise[Math.max(0, k - 2)] + 2 * noise[k] + noise[Math.min(B - 1, k + 2)]) / 4 + 1e-12;
  // 2) فلتر Wiener مع تقدير السيجنال السابق
  const beta = 1 + strength * 1.5, floor = Math.pow(10, -(8 + strength * 22) / 20), alpha = 0.95;
  const prevS = new Float32Array(B), g = new Float32Array(B), out = new Float32Array(tot);
  for (let f = 0; f < nF; f++) {
    analyze(f);
    for (let k = 0; k < B; k++) {
      const y2 = pw[f * B + k], nn = beta * nz[k];
      const post = y2 / nn;
      const prior = alpha * (prevS[k] / nn) + (1 - alpha) * Math.max(post - 1, 0);
      g[k] = Math.max(floor, prior / (1 + prior));
      prevS[k] = g[k] * g[k] * y2;
    }
    for (let k = 0; k < B; k++) {
      const gs = (g[Math.max(0, k - 1)] + 2 * g[k] + g[Math.min(B - 1, k + 1)]) / 4;
      re[k] *= gs; im[k] *= gs;
      if (k > 0 && k < N / 2) { re[N - k] = re[k]; im[N - k] = -im[k]; }
    }
    im[0] = 0; im[N / 2] = 0;
    fft(re, im, true);
    const o = f * H;
    for (let i = 0; i < N; i++) out[o + i] += re[i] * win[i] * 0.5;
  }
  return out.slice(pad, pad + len);
}

// Gate: يخفض الصوت في الفراغات بين الكلام (بيفتح قبل بداية الكلام بـ10 ملي ثانية)
export function gate(x, sr, amount) {
  const hop = Math.round(sr * 0.005), win = hop * 4, nF = Math.floor(x.length / hop);
  if (nF < 8) return Float32Array.from(x);
  const env = new Float32Array(nF);
  for (let j = 0; j < nF; j++) {
    let s = 0, c = 0;
    for (let i = Math.max(0, j * hop - win / 2); i < Math.min(x.length, j * hop + win / 2); i++) { s += x[i] * x[i]; c++; }
    env[j] = Math.sqrt(s / Math.max(1, c));
  }
  const sorted = Float32Array.from(env).sort();
  const floor = sorted[Math.floor(nF * 0.1)] + 1e-7, thr = floor * 3;
  const att = Math.pow(10, -(6 + amount * 18) / 20);
  const tgt = new Float32Array(nF);
  for (let j = 0; j < nF; j++) tgt[j] = env[j] >= thr ? 1 : Math.max(att, Math.pow(env[j] / thr, 1.5));
  const g = new Float32Array(nF);
  let s = 1;
  for (let j = 0; j < nF; j++) {
    const t = Math.max(tgt[j], tgt[Math.min(nF - 1, j + 1)], tgt[Math.min(nF - 1, j + 2)]);
    const tc = t > s ? 0.006 : 0.12;
    s += (t - s) * (1 - Math.exp(-0.005 / tc));
    g[j] = s;
  }
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const p = i / hop, j = Math.min(nF - 2, Math.floor(p)), fr = p - j;
    out[i] = x[i] * (g[j] * (1 - fr) + g[Math.min(nF - 1, j + 1)] * fr);
  }
  return out;
}

// رفع المستوى لقمة معينة (مع حد أقصى للتكبير)
export function normalize(x, peak = 0.7, maxGain = 10) {
  let pk = 0;
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > pk) pk = a; }
  if (pk < 1e-5) return Float32Array.from(x);
  const g = Math.min(maxGain, peak / pk), out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] * g;
  return out;
}

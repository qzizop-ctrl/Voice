import { toWav } from '../dsp/wav.js';

let ctx = null;
export function getCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'playback' });
  return ctx;
}

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ريڤيرب: pre-delay + انعكاسات مبكرة + ذيل بيخفت ويفقد الترددات العالية مع الوقت
const REVERBS = {
  room: { pre: 0.005, k0: 0.9, k1: 0.3, er: true },
  hall: { pre: 0.025, k0: 0.85, k1: 0.12, er: true },
  plate: { pre: 0.01, k0: 0.97, k1: 0.45, er: false },
};
export function makeIR(type, sec, c) {
  const R = REVERBS[type] || REVERBS.hall, rate = c.sampleRate;
  const pre = Math.floor(rate * R.pre), len = Math.floor(rate * (sec + R.pre)), ir = c.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const rnd = rng(1234 + ch * 77), d = ir.getChannelData(ch);
    let y = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / rate, env = Math.exp((-6.9 * t) / sec);
      const k = R.k1 + (R.k0 - R.k1) * Math.exp((-4 * t) / sec);
      y += ((rnd() * 2 - 1) - y) * k;
      d[i] = y * env * Math.min(1, t * 400);
    }
    if (R.er) {
      for (let n = 0; n < 8; n++) {
        const at = pre + Math.floor(rnd() * 0.07 * rate);
        if (at < len) d[at] += (rnd() * 2 - 1) * 0.8 * Math.exp(-n * 0.25);
      }
    }
  }
  return ir;
}

const biq = (c, type, f, q, g) => {
  const n = c.createBiquadFilter();
  n.type = type; n.frequency.value = f;
  if (q !== undefined) n.Q.value = q;
  if (g !== undefined) n.gain.value = g;
  return n;
};
const comp = (c) => c.createDynamicsCompressor();

// سلسلة المعالجة: HPF > EQ > Compressor > De-esser > (جاف + ريڤيرب + إيكو) > Limiter
function buildChain(c, p, out) {
  const input = c.createGain();
  const hpf = biq(c, 'highpass', 80, 0.7071);
  const mud = biq(c, 'peaking', 250, 1, 0);
  const pres = biq(c, 'peaking', 3200, 0.9, 0);
  const air = biq(c, 'highshelf', 10000, undefined, 0);
  const cmp = comp(c), makeup = c.createGain();
  // مقسّم ترددات Linkwitz-Riley لتخفيف حرف السين فقط
  const lp1 = biq(c, 'lowpass', 5500, 0.7071), lp2 = biq(c, 'lowpass', 5500, 0.7071);
  const hp1 = biq(c, 'highpass', 5500, 0.7071), hp2 = biq(c, 'highpass', 5500, 0.7071);
  const des = comp(c), sum = c.createGain();
  const dry = c.createGain(), conv = c.createConvolver(), wet = c.createGain();
  const dly = c.createDelay(1.5), elp = biq(c, 'lowpass', 3500, 0.7071), fb = c.createGain(), ewet = c.createGain();
  const lim = comp(c), outG = c.createGain();

  input.connect(hpf); hpf.connect(mud); mud.connect(pres); pres.connect(air); air.connect(cmp); cmp.connect(makeup);
  makeup.connect(lp1); lp1.connect(lp2); lp2.connect(sum);
  makeup.connect(hp1); hp1.connect(hp2); hp2.connect(des); des.connect(sum);
  sum.connect(dry); dry.connect(lim);
  sum.connect(conv); conv.connect(wet); wet.connect(lim);
  sum.connect(dly); dly.connect(elp); elp.connect(fb); fb.connect(dly); elp.connect(ewet); ewet.connect(lim);
  lim.connect(outG); outG.connect(out);

  const db = (v) => Math.pow(10, v / 20);
  const set = (q) => {
    hpf.frequency.value = q.hp; mud.gain.value = q.mud; pres.gain.value = q.pres; air.gain.value = q.air;
    cmp.threshold.value = q.cthr; cmp.ratio.value = q.cratio; cmp.knee.value = 12; cmp.attack.value = 0.006; cmp.release.value = 0.18;
    makeup.gain.value = db(-q.cthr * (1 - 1 / q.cratio) * 0.4);
    des.threshold.value = -18 - q.deess * 0.3; des.ratio.value = 2 + q.deess * 0.06;
    des.knee.value = 6; des.attack.value = 0.002; des.release.value = 0.06;
    const m = q.mix / 100;
    dry.gain.value = 1 - m * 0.4; wet.gain.value = m * 1.8;
    dly.delayTime.value = q.etime / 1000; fb.gain.value = (q.efb / 100) * 0.75; ewet.gain.value = (q.echo / 100) * 0.8;
  };
  lim.threshold.value = -1.5; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.08;
  outG.gain.value = 0.97;
  conv.buffer = makeIR(p.rtype, p.size / 10, c);
  set(p);
  return { input, set, setReverb: (type, size) => { conv.buffer = makeIR(type, size / 10, c); } };
}

export function createPlayer() {
  let chain = null, src = null, hsrc = null, hg = null;
  const stop = () => {
    [src, hsrc].forEach((s) => { if (s) { s.onended = null; try { s.stop(); } catch (e) {} } });
    src = hsrc = hg = null;
  };
  return {
    stop,
    update(p, hvol) {
      if (!chain) return;
      chain.set(p);
      if (hg) hg.gain.value = hvol / 100;
    },
    setReverb(type, size) { if (chain) chain.setReverb(type, size); },
    // تشغيل التسجيل الخام مباشرة بدون أي تأثيرات (للمقارنة والتشخيص)
    async playDry(buf, onEnd) {
      const c = getCtx();
      await c.resume();
      stop();
      src = c.createBufferSource();
      src.buffer = buf;
      src.connect(c.destination);
      src.onended = () => { src = null; onEnd && onEnd(); };
      src.start();
    },
    async play(buf, harm, p, hvol, onEnd) {
      const c = getCtx();
      await c.resume();
      stop();
      if (!chain) chain = buildChain(c, p, c.destination);
      chain.set(p); chain.setReverb(p.rtype, p.size);
      src = c.createBufferSource();
      src.buffer = buf;
      src.connect(chain.input);
      src.onended = () => { src = null; onEnd && onEnd(); };
      if (harm) {
        hsrc = c.createBufferSource(); hsrc.buffer = harm;
        hg = c.createGain(); hg.gain.value = hvol / 100;
        hsrc.connect(hg); hg.connect(chain.input); hsrc.start();
      }
      src.start();
    },
  };
}

// تسجيل خام (PCM) بدون ضغط عن طريق AudioWorklet، مع بديل MediaRecorder لو غير مدعوم
const WORKLET_CODE = `class RecProc extends AudioWorkletProcessor{process(i){const c=i[0]&&i[0][0];if(c)this.port.postMessage(c.slice(0));return true}}registerProcessor('rec-proc',RecProc);`;
let workletReady = false;
async function ensureWorklet(c) {
  if (workletReady) return;
  const url = URL.createObjectURL(new Blob([WORKLET_CODE], { type: 'application/javascript' }));
  await c.audioWorklet.addModule(url);
  workletReady = true;
}

export async function startRecording(noiseSuppression) {
  const c = getCtx();
  await c.resume();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression, autoGainControl: false, channelCount: 1 },
  });
  const analyser = c.createAnalyser();
  const srcNode = c.createMediaStreamSource(stream);
  srcNode.connect(analyser);
  const stopTracks = () => stream.getTracks().forEach((t) => t.stop());

  try {
    await ensureWorklet(c);
    const node = new AudioWorkletNode(c, 'rec-proc', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' });
    const mute = c.createGain(); mute.gain.value = 0;
    const chunks = []; let total = 0;
    node.port.onmessage = (e) => { chunks.push(e.data); total += e.data.length; };
    srcNode.connect(node); node.connect(mute); mute.connect(c.destination);
    return {
      analyser, mode: 'pcm',
      stop: async () => {
        stopTracks(); srcNode.disconnect(); node.disconnect(); mute.disconnect(); node.port.onmessage = null;
        const buf = c.createBuffer(1, Math.max(1, total), c.sampleRate), d = buf.getChannelData(0);
        let o = 0;
        for (const ch of chunks) { d.set(ch, o); o += ch.length; }
        return buf;
      },
    };
  } catch (e) {
    const rec = new MediaRecorder(stream), chunks = [];
    rec.ondataavailable = (ev) => chunks.push(ev.data);
    const done = new Promise((resolve, reject) => {
      rec.onstop = async () => {
        stopTracks();
        try {
          const blob = new Blob(chunks, { type: rec.mimeType });
          resolve(await c.decodeAudioData(await blob.arrayBuffer()));
        } catch (err) { reject(err); }
      };
    });
    rec.start();
    return { analyser, mode: 'media', stop: () => { rec.stop(); return done; } };
  }
}

// تجميع الصوت النهائي بكل التأثيرات إلى WAV
export async function exportWav(buf, harm, p, hvol) {
  const sr = buf.sampleRate;
  let tail = p.size / 10;
  if (p.echo > 0 && p.efb > 0) {
    const reps = Math.min(12, Math.ceil(Math.log(0.02) / Math.log((p.efb / 100) * 0.75 || 0.01)));
    tail = Math.max(tail, (reps * p.etime) / 1000);
  }
  const dur = Math.max(buf.duration, harm ? harm.duration : 0) + tail + 0.2;
  const oc = new OfflineAudioContext(2, Math.ceil(dur * sr), sr);
  const chain = buildChain(oc, p, oc.destination);
  const s1 = oc.createBufferSource(); s1.buffer = buf; s1.connect(chain.input); s1.start();
  if (harm) {
    const s2 = oc.createBufferSource(), g = oc.createGain();
    s2.buffer = harm; g.gain.value = hvol / 100;
    s2.connect(g); g.connect(chain.input); s2.start();
  }
  return toWav(await oc.startRendering(), 0.9); // رفع/ضبط المستوى لقمة -1 dBFS تقريباً
}

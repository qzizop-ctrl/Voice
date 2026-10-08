import { toWav } from '../dsp/wav.js';

let ctx = null;
export function getCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  return ctx;
}

// ريڤيرب بسيط: ضوضاء تتلاشى أسياً
export function makeIR(sec, c) {
  const rate = c.sampleRate, len = Math.floor(rate * sec), ir = c.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  }
  return ir;
}

// سلسلة التأثيرات: فلتر قطع الترددات المنخفضة -> (جاف + ريڤيرب)
function buildChain(c, p, out) {
  const hpf = c.createBiquadFilter();
  hpf.type = 'highpass';
  const dry = c.createGain(), wet = c.createGain(), conv = c.createConvolver();
  hpf.connect(dry); hpf.connect(conv); conv.connect(wet);
  dry.connect(out); wet.connect(out);
  const set = (q) => {
    const m = q.mix / 100;
    dry.gain.value = 1 - m * 0.5;
    wet.gain.value = m * 1.6;
    hpf.frequency.value = q.hp;
  };
  conv.buffer = makeIR(p.size / 10, c);
  set(p);
  return { input: hpf, set, setSize: (s) => { conv.buffer = makeIR(s / 10, c); } };
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
    setSize(s) { if (chain) chain.setSize(s); },
    async play(buf, harm, p, hvol, onEnd) {
      const c = getCtx();
      await c.resume();
      stop();
      if (!chain) chain = buildChain(c, p, c.destination);
      chain.set(p); chain.setSize(p.size);
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

export async function startRecording(noiseSuppression) {
  const c = getCtx();
  await c.resume();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression, autoGainControl: false },
  });
  const rec = new MediaRecorder(stream), chunks = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  const analyser = c.createAnalyser();
  c.createMediaStreamSource(stream).connect(analyser);
  const done = new Promise((resolve, reject) => {
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      try {
        const blob = new Blob(chunks, { type: rec.mimeType });
        resolve(await c.decodeAudioData(await blob.arrayBuffer()));
      } catch (e) { reject(e); }
    };
  });
  rec.start();
  return { analyser, stop: () => { rec.stop(); return done; } };
}

// تجميع الصوت النهائي بكل التأثيرات إلى WAV
export async function exportWav(buf, harm, p, hvol) {
  const sr = buf.sampleRate, tail = p.size / 10;
  const dur = Math.max(buf.duration, harm ? harm.duration : 0) + tail;
  const oc = new OfflineAudioContext(2, Math.ceil(dur * sr), sr);
  const chain = buildChain(oc, p, oc.destination);
  const s1 = oc.createBufferSource(); s1.buffer = buf; s1.connect(chain.input); s1.start();
  if (harm) {
    const s2 = oc.createBufferSource(), g = oc.createGain();
    s2.buffer = harm; g.gain.value = hvol / 100;
    s2.connect(g); g.connect(chain.input); s2.start();
  }
  return toWav(await oc.startRendering());
}

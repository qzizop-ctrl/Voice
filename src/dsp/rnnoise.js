// تنقية بالذكاء الاصطناعي (RNNoise) على تسجيل جاهز.
// الطريقة الأولى: OfflineAudioContext (سريعة). الثانية: تشغيل فعلي (أبطأ لكن أكثر توافقاً).
// لو الناتج طلع فاضي/تالف بنرفضه ونرمي خطأ بدل ما نمسح التسجيل.
import { loadRnnoise, RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor';
import workletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import wasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import simdUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';

const SR = 48000;   // RNNoise يشتغل على 48 كيلوهرتز فقط
const FRAME = 480;  // حجم الإطار (10 ملي ثانية)
let wasm = null;

export const RNNOISE_RATE = SR;

const rms = (a) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s / Math.max(1, a.length));
};
// الناتج سليم لو أرقامه صحيحة وفيه صوت فعلي (مش صمت)
const valid = (out, inp) => {
  const r = rms(out);
  return Number.isFinite(r) && r > 0.02 * rms(inp);
};

async function offline(buf) {
  const n = Math.floor(buf.duration * SR);
  const oc = new OfflineAudioContext(1, n + FRAME * 4, SR);
  await oc.audioWorklet.addModule(workletUrl);
  const src = oc.createBufferSource();
  src.buffer = buf;
  const node = new RnnoiseWorkletNode(oc, { wasmBinary: wasm, maxChannels: 1 });
  src.connect(node); node.connect(oc.destination); src.start();
  const out = (await oc.startRendering()).getChannelData(0);
  return out.slice(FRAME, FRAME + n);
}

const REC_CODE = `class P extends AudioWorkletProcessor{process(i){const c=i[0]&&i[0][0];if(c)this.port.postMessage(c.slice(0));return true}}registerProcessor('rn-rec',P);`;

async function realtime(buf) {
  const ac = new AudioContext({ sampleRate: SR });
  try {
    await ac.resume();
    await ac.audioWorklet.addModule(workletUrl);
    await ac.audioWorklet.addModule(URL.createObjectURL(new Blob([REC_CODE], { type: 'application/javascript' })));
    const node = new RnnoiseWorkletNode(ac, { wasmBinary: wasm, maxChannels: 1 });
    const rec = new AudioWorkletNode(ac, 'rn-rec', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' });
    const mute = ac.createGain(); mute.gain.value = 0;
    const chunks = []; let total = 0;
    rec.port.onmessage = (e) => { chunks.push(e.data); total += e.data.length; };
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.connect(node); node.connect(rec); rec.connect(mute); mute.connect(ac.destination);
    await new Promise((res) => { src.onended = res; src.start(); });
    await new Promise((r) => setTimeout(r, 300));
    const out = new Float32Array(total);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    const n = Math.floor(buf.duration * SR);
    return out.slice(FRAME, FRAME + n);
  } finally { ac.close(); }
}

export async function rnnoiseClean(buf, onStatus) {
  if (!wasm) wasm = await loadRnnoise({ url: wasmUrl, simdUrl });
  const inp = buf.getChannelData(0);
  try {
    const o = await offline(buf);
    if (valid(o, inp)) return { data: o, how: 'offline' };
    console.warn('RNNoise offline output was silent/invalid');
  } catch (e) { console.warn('RNNoise offline failed', e); }
  if (onStatus) onStatus('جاري المحاولة بطريقة ثانية (بتاخد وقت قد مدة التسجيل)...');
  const o = await realtime(buf);
  if (valid(o, inp)) return { data: o, how: 'realtime' };
  throw new Error('RNNOISE_SILENT');
}

// تنقية بالذكاء الاصطناعي (RNNoise) على تسجيل جاهز، عبر OfflineAudioContext
import { loadRnnoise, RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor';
import workletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import wasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import simdUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';

const SR = 48000;   // RNNoise يشتغل على 48 كيلوهرتز فقط
const FRAME = 480;  // حجم الإطار (10 ملي ثانية)
let wasm = null;

export async function rnnoiseClean(buf) {
  if (!wasm) wasm = await loadRnnoise({ url: wasmUrl, simdUrl });
  const n = Math.floor(buf.duration * SR);
  const oc = new OfflineAudioContext(1, n + FRAME * 4, SR);
  await oc.audioWorklet.addModule(workletUrl);
  const src = oc.createBufferSource();
  src.buffer = buf; // يتحول تلقائياً لـ 48k وأحادي
  const node = new RnnoiseWorkletNode(oc, { wasmBinary: wasm, maxChannels: 1 });
  src.connect(node);
  node.connect(oc.destination);
  src.start();
  const out = (await oc.startRendering()).getChannelData(0);
  return out.slice(FRAME, FRAME + n); // نشيل التأخير الداخلي
}

export const RNNOISE_RATE = SR;

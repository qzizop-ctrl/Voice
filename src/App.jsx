import { useEffect, useRef, useState } from 'react';
import { createPlayer, exportWav, getCtx, startRecording } from './audio/engine.js';
import { autotune, detect, harmShifts, makeAllowed, render } from './dsp/pitch.js';
import { denoise } from './dsp/denoise.js';
import { DEFAULT_FX, PRESETS, REVERB_TYPES } from './presets.js';
import { saveWav } from './export.js';

const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SCALES = [
  ['ميجر', '0,2,4,5,7,9,11'],
  ['ماينر', '0,2,3,5,7,8,10'],
  ['كروماتيك', '0,1,2,3,4,5,6,7,8,9,10,11'],
];
const INTERVALS = [['ثالثة فوق', '2'], ['خامسة فوق', '4'], ['ثالثة تحت', '-2'], ['أوكتاف فوق', '7']];

const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

function drawWave(cv, data) {
  const g = cv.getContext('2d'), w = cv.width, h = cv.height, step = Math.floor(data.length / w) || 1;
  g.clearRect(0, 0, w, h);
  g.fillStyle = css('--wave');
  for (let x = 0; x < w; x += 3) {
    let mx = 0;
    for (let j = 0; j < step * 3; j++) { const v = Math.abs(data[x * step + j] || 0); if (v > mx) mx = v; }
    const bh = Math.max(2, mx * h * 0.95);
    g.fillRect(x, (h - bh) / 2, 2, bh);
  }
}

function Slider({ label, value, unit = '', onChange, min = 0, max = 100, step = 1 }) {
  return (
    <>
      <label><span>{label}</span><span>{value}{unit}</span></label>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
    </>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <label>
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([t, v]) => <option key={v} value={v}>{t}</option>)}
      </select>
    </label>
  );
}

export default function App() {
  const cv = useRef(null), raf = useRef(0), player = useRef(null);
  const rec = useRef(null), raw = useRef(null), orig = useRef(null), cur = useRef(null), harm = useRef(null);
  const [msg, setMsg] = useState('اضغط تسجيل وابدأ الغناء أو الكلام. يُفضّل استخدام سماعة سلكية.');
  const [recording, setRecording] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ver, setVer] = useState(0);
  const [micNs, setMicNs] = useState(true);
  const [fx, setFx] = useState(DEFAULT_FX);
  const [ns, setNs] = useState(70);
  const [tune, setTune] = useState({ key: '0', scale: SCALES[0][1], str: 100, spd: 70, vib: 40 });
  const [hint, setHint] = useState('2');
  const [hvol, setHvol] = useState(60);

  if (!player.current) player.current = createPlayer();
  const hasAudio = !!cur.current;
  const bump = () => setVer((v) => v + 1);
  const F = (k) => (v) => setFx((f) => ({ ...f, [k]: v }));

  useEffect(() => { player.current.update(fx, hvol); }, [fx, hvol]);
  useEffect(() => { player.current.setReverb(fx.rtype, fx.size); }, [fx.rtype, fx.size]);
  useEffect(() => { if (cur.current && cv.current) drawWave(cv.current, cur.current.getChannelData(0)); }, [ver]);

  const mkBuf = (data, sr) => {
    const b = getCtx().createBuffer(1, data.length, sr);
    b.getChannelData(0).set(data);
    return b;
  };
  const stopPlay = () => { player.current.stop(); setPlaying(false); };
  const work = (label, fn) => {
    stopPlay(); setBusy(true); setMsg(label);
    setTimeout(() => {
      try { fn(); } catch (e) { setMsg('حصل خطأ أثناء المعالجة.'); }
      setBusy(false);
    }, 40);
  };

  const drawLive = (an) => {
    const c = cv.current, g = c.getContext('2d'), a = new Uint8Array(an.fftSize);
    const loop = () => {
      an.getByteTimeDomainData(a);
      g.clearRect(0, 0, c.width, c.height);
      g.strokeStyle = css('--rec'); g.lineWidth = 3; g.beginPath();
      for (let i = 0; i < a.length; i++) {
        const x = (i / a.length) * c.width, y = (a[i] / 255) * c.height;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
      raf.current = requestAnimationFrame(loop);
    };
    loop();
  };

  const onRecord = async () => {
    if (recording) {
      cancelAnimationFrame(raf.current);
      setRecording(false);
      try {
        const b = await rec.current.stop();
        raw.current = orig.current = cur.current = b;
        harm.current = null;
        setMsg(`تم التسجيل (${b.duration.toFixed(1)} ث${rec.current.mode === 'pcm' ? '، جودة خام بدون ضغط' : ''}). اضغط تشغيل.`);
      } catch (e) { setMsg('فشل قراءة التسجيل، جرّب مرة تانية.'); }
      bump();
      return;
    }
    stopPlay();
    try {
      rec.current = await startRecording(micNs);
    } catch (e) { setMsg('تعذر الوصول للميكروفون. اسمح بالإذن من إعدادات التطبيق.'); return; }
    setRecording(true); setMsg('جاري التسجيل...');
    drawLive(rec.current.analyser);
  };

  const onPlay = async () => {
    if (playing) { stopPlay(); return; }
    if (!cur.current) return;
    setPlaying(true);
    await player.current.play(cur.current, harm.current, fx, hvol, () => setPlaying(false));
  };

  const onDenoise = () => work('جاري تنقية الصوت...', () => {
    const o = denoise(raw.current.getChannelData(0), ns / 100);
    orig.current = cur.current = mkBuf(o, raw.current.sampleRate);
    harm.current = null; bump();
    setMsg('تمت التنقية. اضغط تشغيل. لو الصوت اتأثر زيادة قلل القوة وجرّب تاني.');
  });
  const onUndoDenoise = () => {
    stopPlay(); orig.current = cur.current = raw.current; harm.current = null; bump();
    setMsg('رجعت للتسجيل الأصلي بدون تنقية.');
  };

  const onRnn = async () => {
    stopPlay(); setBusy(true); setMsg('جاري التنقية بالذكاء الاصطناعي (RNNoise)...');
    try {
      const { rnnoiseClean, RNNOISE_RATE } = await import('./dsp/rnnoise.js');
      const { data } = await rnnoiseClean(raw.current, setMsg);
      orig.current = cur.current = mkBuf(data, RNNOISE_RATE);
      harm.current = null; bump();
      setMsg('تمت التنقية بـ RNNoise. اضغط تشغيل.');
    } catch (e) {
      // التسجيل ما بيتمسحش: نرجع للتنقية العادية لو RNNoise ما اشتغلش صح
      console.error(e);
      try {
        const o = denoise(raw.current.getChannelData(0), ns / 100);
        orig.current = cur.current = mkBuf(o, raw.current.sampleRate);
        harm.current = null; bump();
        setMsg('RNNoise ما اشتغلش صح على جهازك (كان بيطلع صوت فاضي)، فطبّقت التنقية القوية العادية بدالها.');
      } catch (e2) { setMsg('تعذرت التنقية. التسجيل الأصلي ما اتغيرش.'); }
    }
    setBusy(false);
  };

  const onTune = () => work('جاري تحليل الصوت وتصحيح النغمات...', () => {
    const o = autotune(orig.current.getChannelData(0), orig.current.sampleRate, +tune.key,
      tune.scale.split(',').map(Number), tune.str / 100, tune.spd / 100, tune.vib / 100);
    cur.current = mkBuf(o, orig.current.sampleRate); bump();
    setMsg('تم الأوتوتيون. اضغط تشغيل، وغيّر المفتاح أو السرعة لو مش عاجبك.');
  });
  const onOrig = () => { stopPlay(); cur.current = orig.current; bump(); setMsg('رجعت للصوت قبل الأوتوتيون.'); };

  const onHarm = () => work('جاري توليد الهارموني...', () => {
    const x = cur.current.getChannelData(0), sr = cur.current.sampleRate;
    const scale = tune.scale.split(',').map(Number);
    const f0 = detect(x, sr);
    if (!f0.length) { setMsg('التسجيل قصير جداً.'); return; }
    const sh = harmShifts(f0, makeAllowed(+tune.key, scale), +hint, 0.5, scale.length === 12);
    harm.current = mkBuf(render(x, sr, f0, sh), sr); bump();
    setMsg('تم توليد الهارموني. اضغط تشغيل.');
  });
  const onHarmClear = () => { stopPlay(); harm.current = null; bump(); setMsg('تمت إزالة الهارموني.'); };

  const onExport = async () => {
    stopPlay(); setBusy(true); setMsg('جاري تجهيز الملف النهائي...');
    try {
      const wav = await exportWav(cur.current, harm.current, fx, hvol);
      await saveWav(wav, 'my-voice.wav');
      setMsg('تم تجهيز الملف my-voice.wav.');
    } catch (e) { console.error(e); setMsg('تعذر تصدير الملف.'); }
    setBusy(false);
  };

  const off = !hasAudio || busy || recording;
  const hasNs = raw.current && orig.current !== raw.current;
  const hasTuned = cur.current !== orig.current;
  return (
    <main>
      <h1>استوديو الصوت</h1>
      <p className="sub">سجّل، نقّي، صحّح النغمات، ضيف هارموني وتأثيرات، وصدّر.</p>

      <div className="card">
        <canvas ref={cv} width="600" height="220" />
        <div className="row">
          <button id="rec" disabled={busy} onClick={onRecord}>{recording ? 'إيقاف' : 'تسجيل'}</button>
          <button id="play" disabled={off} onClick={onPlay}>{playing ? 'إيقاف' : 'تشغيل'}</button>
        </div>
        <label className="chk">
          <input type="checkbox" checked={micNs} onChange={(e) => setMicNs(e.target.checked)} />
          تقليل الضوضاء الأساسي من الميكروفون
        </label>
        <div id="msg">{msg}</div>
      </div>

      <div className="card">
        <h2>1. تنقية الصوت</h2>
        <Slider label="قوة التنقية" unit="%" value={ns} min={10} onChange={setNs} />
        <div className="row">
          <button id="tune" disabled={off} onClick={onDenoise}>تنقية قوية</button>
          <button disabled={off || !hasNs} onClick={onUndoDenoise}>تراجع عن التنقية</button>
        </div>
        <div className="row">
          <button disabled={off} onClick={onRnn}>تنقية بالذكاء الاصطناعي (RNNoise)</button>
        </div>
        <div className="sub small">التنقية القوية تناسب الضوضاء الثابتة. RNNoise أقوى مع الضوضاء المتغيرة والكلام الخلفي. طبّق أيًّا منهما قبل الأوتوتيون.</div>
      </div>

      <div className="card">
        <h2>2. الأوتوتيون</h2>
        <Select label="المفتاح" value={tune.key} onChange={(v) => setTune({ ...tune, key: v })} options={KEYS.map((k, i) => [k, String(i)])} />
        <Select label="السلم" value={tune.scale} onChange={(v) => setTune({ ...tune, scale: v })} options={SCALES} />
        <Slider label="قوة التصحيح" unit="%" value={tune.str} onChange={(v) => setTune({ ...tune, str: v })} />
        <Slider label="سرعة التصحيح (أعلى = روبوتي)" unit="%" value={tune.spd} min={5} onChange={(v) => setTune({ ...tune, spd: v })} />
        <Slider label="الاحتفاظ بالاهتزاز الطبيعي" unit="%" value={tune.vib} onChange={(v) => setTune({ ...tune, vib: v })} />
        <div className="row">
          <button id="tune" disabled={off} onClick={onTune}>طبّق الأوتوتيون</button>
          <button disabled={off || !hasTuned} onClick={onOrig}>الصوت قبل الأوتوتيون</button>
        </div>
      </div>

      <div className="card">
        <h2>3. الهارموني</h2>
        <Select label="طبقة الهارموني" value={hint} onChange={setHint} options={INTERVALS} />
        <Slider label="مستوى صوت الهارموني" unit="%" value={hvol} onChange={setHvol} />
        <div className="row">
          <button disabled={off} onClick={onHarm}>ولّد الهارموني</button>
          <button disabled={off || !harm.current} onClick={onHarmClear}>إزالة الهارموني</button>
        </div>
      </div>

      <div className="card">
        <h2>4. جودة الصوت (ماستر)</h2>
        <div className="presets">
          {PRESETS.map(([name, p]) => (
            <button key={name} onClick={() => setFx((f) => ({ ...f, ...p }))}>{name}</button>
          ))}
        </div>
        <Slider label="قطع الترددات المنخفضة" unit=" هرتز" value={fx.hp} min={20} max={300} onChange={F('hp')} />
        <Slider label="تخفيف الاحتقان (250 هرتز)" unit=" dB" value={fx.mud} min={-8} max={4} step={0.5} onChange={F('mud')} />
        <Slider label="وضوح الصوت (3 كيلو)" unit=" dB" value={fx.pres} min={-4} max={8} step={0.5} onChange={F('pres')} />
        <Slider label="لمعة (10 كيلو)" unit=" dB" value={fx.air} min={-4} max={8} step={0.5} onChange={F('air')} />
        <Slider label="الكومبريسور: الحد" unit=" dB" value={fx.cthr} min={-40} max={-6} onChange={F('cthr')} />
        <Slider label="الكومبريسور: النسبة" unit=":1" value={fx.cratio} min={1} max={10} step={0.5} onChange={F('cratio')} />
        <Slider label="تخفيف حرف السين (De-esser)" unit="%" value={fx.deess} onChange={F('deess')} />
        <div className="sub small">يوجد Limiter في النهاية يمنع التشويش تلقائياً.</div>
      </div>

      <div className="card">
        <h2>5. الريڤيرب والإيكو</h2>
        <Select label="نوع الريڤيرب" value={fx.rtype} onChange={F('rtype')} options={REVERB_TYPES} />
        <Slider label="كمية الريڤيرب" unit="%" value={fx.mix} onChange={F('mix')} />
        <Slider label="طول الريڤيرب (بالعُشر ثانية)" value={fx.size} min={3} max={60} onChange={F('size')} />
        <Slider label="كمية الإيكو" unit="%" value={fx.echo} onChange={F('echo')} />
        <Slider label="زمن الإيكو" unit=" مللي ث" value={fx.etime} min={80} max={600} step={10} onChange={F('etime')} />
        <Slider label="تكرار الإيكو" unit="%" value={fx.efb} onChange={F('efb')} />
      </div>

      <div className="card">
        <button style={{ width: '100%' }} disabled={off} onClick={onExport}>تصدير الصوت النهائي (WAV)</button>
      </div>
    </main>
  );
}

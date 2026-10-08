// كشف النغمة (YIN) + أوتوتيون وهارموني بطريقة PSOLA (بتحافظ على لون الصوت/الفورمانت)

// تنظيف مسار النغمة: إصلاح قفزات الأوكتاف، سد الفجوات القصيرة، وفلتر وسيط
function cleanPitch(f0) {
  const F = f0.length, a = new Float32Array(F);
  let prev = 0, gap = 0;
  for (let j = 0; j < F; j++) {
    let f = f0[j];
    if (f > 0) {
      if (prev > 0) {
        const r = f / prev;
        if (r > 1.9 && r < 2.1) f /= 2;
        else if (r > 0.47 && r < 0.53) f *= 2;
      }
      prev = f; gap = 0;
    } else if (++gap > 3) prev = 0;
    a[j] = f;
  }
  // سد فجوة من إطار أو اتنين بين نغمتين متقاربتين
  for (let j = 1; j < F - 2; j++) {
    for (const g of [1, 2]) {
      if (a[j] === 0 && a[j - 1] > 0 && a[j + g] > 0 && j + g < F) {
        let ok = true;
        for (let k = 0; k < g; k++) if (a[j + k] !== 0) ok = false;
        const r = a[j + g] / a[j - 1];
        if (ok && r > 0.92 && r < 1.08) {
          for (let k = 0; k < g; k++) a[j + k] = a[j - 1] + ((a[j + g] - a[j - 1]) * (k + 1)) / (g + 1);
        }
      }
    }
  }
  const o = new Float32Array(F);
  for (let j = 0; j < F; j++) {
    if (a[j] <= 0) continue;
    const v = [];
    for (let k = Math.max(0, j - 2); k <= Math.min(F - 1, j + 2); k++) if (a[k] > 0) v.push(a[k]);
    if (v.length >= 3) { v.sort((p, q) => p - q); o[j] = v[v.length >> 1]; } else o[j] = a[j];
  }
  return o;
}

export function detect(x, sr) {
  const sr2 = sr / 2, n2 = Math.floor(x.length / 2), y = new Float32Array(n2);
  for (let i = 0; i < n2; i++) y[i] = (x[2 * i] + x[2 * i + 1]) * 0.5;
  const W = 640, hop = 256, tmax = Math.floor(sr2 / 70), tmin = Math.floor(sr2 / 800);
  const F = Math.max(0, Math.floor((n2 - W - tmax) / hop)), f0 = new Float32Array(F), d = new Float32Array(tmax + 2);
  for (let j = 0; j < F; j++) {
    const st = j * hop;
    let e = 0;
    for (let i = 0; i < W; i++) e += y[st + i] * y[st + i];
    if (Math.sqrt(e / W) < 0.01) { f0[j] = 0; continue; }
    for (let t = 1; t <= tmax; t++) {
      let sum = 0;
      for (let i = 0; i < W; i++) { const q = y[st + i] - y[st + i + t]; sum += q * q; }
      d[t] = sum;
    }
    let run = 0, tau = 0;
    for (let t = 1; t <= tmax; t++) { run += d[t]; d[t] = (d[t] * t) / run; }
    for (let t = tmin; t < tmax; t++) {
      if (d[t] < 0.15) {
        while (t + 1 < tmax && d[t + 1] < d[t]) t++;
        tau = t; break;
      }
    }
    if (tau > 1 && tau < tmax) {
      // استيفاء بارابولي لدقة أعلى من عينة واحدة
      const a = d[tau - 1], b = d[tau], c = d[tau + 1], den = a - 2 * b + c;
      f0[j] = sr2 / (den !== 0 ? tau + (a - c) / (2 * den) : tau);
    } else f0[j] = 0;
  }
  return cleanPitch(f0);
}

export function snap(f, allowed) {
  const m = 69 + (12 * Math.log(f / 440)) / Math.LN2, r = Math.round(m);
  let best = null, bd = 99;
  for (let k = -3; k <= 3; k++) {
    const c = r + k;
    if (allowed[((c % 12) + 12) % 12]) { const dd = Math.abs(c - m); if (dd < bd) { bd = dd; best = c; } }
  }
  return best === null ? 0 : best - m;
}

export function makeAllowed(key, scale) {
  const a = Array(12).fill(false);
  scale.forEach((n) => { a[(n + key) % 12] = true; });
  return a;
}

const toMidi = (f) => 69 + (12 * Math.log(f / 440)) / Math.LN2;

// أوتوتيون: strength قوة التصحيح، speed سرعته، vib نسبة الاحتفاظ بالاهتزاز الطبيعي (0..1)
export function autotune(x, sr, key, scale, strength, speed, vib = 0.4) {
  const allowed = makeAllowed(key, scale), f0 = detect(x, sr), F = f0.length;
  if (!F) return Float32Array.from(x);
  const m = new Float32Array(F);
  for (let j = 0; j < F; j++) m[j] = f0[j] > 0 ? toMidi(f0[j]) : 0;
  // متوسط متحرك (~100 ملي ثانية) لفصل الاهتزاز عن النغمة المقصودة
  const ms = new Float32Array(F);
  for (let j = 0; j < F; j++) {
    let s = 0, c = 0;
    for (let k = Math.max(0, j - 4); k <= Math.min(F - 1, j + 4); k++) if (m[k] > 0) { s += m[k]; c++; }
    ms[j] = c ? s / c : 0;
  }
  const shifts = new Float32Array(F);
  let s = 0, note = null;
  for (let j = 0; j < F; j++) {
    let tgt = 0;
    if (m[j] > 0) {
      // ثبات على النوتة: ما نغيرهاش إلا لو النغمة ابتعدت بوضوح
      if (note === null || Math.abs(ms[j] - note) > 0.65) {
        note = Math.round(ms[j] + snap(440 * Math.pow(2, (ms[j] - 69) / 12), allowed));
      }
      tgt = (note - m[j] + vib * (m[j] - ms[j])) * strength;
    } else note = null;
    s += (tgt - s) * speed;
    shifts[j] = s;
  }
  return render(x, sr, f0, shifts);
}

// تغيير النغمة بالإزاحة المطلوبة لكل إطار (PSOLA)
export function render(x, sr, f0, shifts) {
  const F = f0.length, len = x.length;
  const fi = (pos) => Math.max(0, Math.min(F - 1, Math.round((pos - 640) / 512)));
  const U = Math.round(sr * 0.008), marks = [];
  let pos = Math.round(sr * 0.01);
  while (pos < len - U * 3) {
    const j = fi(pos), P = f0[j] > 0 ? sr / f0[j] : U;
    marks.push(pos);
    let nx = Math.round(pos + P);
    if (f0[j] > 0) {
      const lo = Math.max(0, Math.round(nx - P / 4)), hi = Math.min(len - 1, Math.round(nx + P / 4));
      let bp = nx, bv = -9;
      for (let q = lo; q <= hi; q++) if (x[q] > bv) { bv = x[q]; bp = q; }
      nx = bp;
    }
    if (nx <= pos) nx = pos + 1;
    pos = nx;
  }
  if (marks.length < 3) return Float32Array.from(x);
  const out = new Float32Array(len), ws = new Float32Array(len);
  let t = marks[0], idx = 0;
  while (t < len - 1) {
    while (idx + 1 < marks.length && Math.abs(marks[idx + 1] - t) <= Math.abs(marks[idx] - t)) idx++;
    const a = marks[idx];
    const Pa = Math.max(idx + 1 < marks.length ? marks[idx + 1] - a : a - marks[idx - 1], 20);
    const tr = Math.round(t);
    for (let i = -Pa; i < Pa; i++) {
      const si = a + i, di = tr + i;
      if (si < 0 || si >= len || di < 0 || di >= len) continue;
      const w = 0.5 + 0.5 * Math.cos((Math.PI * i) / Pa);
      out[di] += x[si] * w; ws[di] += w;
    }
    t += Pa / Math.pow(2, shifts[fi(a)] / 12);
  }
  for (let i = 0; i < len; i++) if (ws[i] > 0.2) out[i] /= ws[i];
  return out;
}

// إزاحات الهارموني: نغمة فوق/تحت بعدد درجات داخل السلم
export function harmShifts(f0, allowed, k, speed, chromatic) {
  const F = f0.length, sh = new Float32Array(F), map = { 2: 4, 4: 7, '-2': -4, 7: 12 };
  let s = 0;
  for (let j = 0; j < F; j++) {
    let tgt = 0;
    if (f0[j] > 0) {
      const m = toMidi(f0[j]), n = Math.round(m + snap(f0[j], allowed));
      let tn = n;
      if (chromatic) tn = n + map[String(k)];
      else {
        let c = Math.abs(k), st = 0;
        const dir = k > 0 ? 1 : -1;
        while (c > 0 && st < 48) { tn += dir; st++; if (allowed[((tn % 12) + 12) % 12]) c--; }
      }
      tgt = tn - m;
    }
    s += (tgt - s) * speed;
    sh[j] = s;
  }
  return sh;
}

// الإعدادات الافتراضية والـ Presets الجاهزة لسلسلة التأثيرات
export const DEFAULT_FX = {
  hp: 80,        // قطع الترددات المنخفضة (هرتز)
  mud: -2,       // تخفيف الاحتقان 250 هرتز (ديسيبل)
  pres: 2,       // وضوح الصوت 3.2 كيلوهرتز (ديسيبل)
  air: 1.5,      // لمعة 10 كيلوهرتز (ديسيبل)
  cthr: -22,     // حد الكومبريسور (ديسيبل)
  cratio: 3,     // نسبة الكومبريسور
  deess: 35,     // قوة تخفيف حرف السين %
  rtype: 'hall', // نوع الريڤيرب
  mix: 25,       // كمية الريڤيرب %
  size: 18,      // طول الريڤيرب (عُشر ثانية)
  echo: 0,       // كمية الإيكو %
  etime: 280,    // زمن الإيكو (مللي ثانية)
  efb: 30,       // تكرار الإيكو %
};

export const PRESETS = [
  ['غناء', { hp: 90, mud: -2, pres: 2.5, air: 2, cthr: -22, cratio: 3, deess: 40, rtype: 'hall', mix: 30, size: 22, echo: 8, etime: 300, efb: 30 }],
  ['راب', { hp: 100, mud: -3, pres: 3, air: 1.5, cthr: -26, cratio: 4, deess: 50, rtype: 'room', mix: 12, size: 8, echo: 18, etime: 250, efb: 30 }],
  ['بودكاست', { hp: 110, mud: -3, pres: 3, air: 0.5, cthr: -24, cratio: 3.5, deess: 45, rtype: 'room', mix: 0, size: 6, echo: 0, etime: 280, efb: 30 }],
  ['نظيف', { hp: 80, mud: 0, pres: 0, air: 0, cthr: -12, cratio: 1.5, deess: 20, rtype: 'room', mix: 0, size: 8, echo: 0, etime: 280, efb: 30 }],
];

export const REVERB_TYPES = [['قاعة', 'hall'], ['غرفة', 'room'], ['Plate', 'plate']];

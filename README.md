# استوديو الصوت (Voice Studio)

تطبيق React + Capacitor لأندرويد: تسجيل، تنقية ضوضاء، أوتوتيون، هارموني، ريڤيرب، وتصدير WAV.

## هيكل المشروع
- `src/dsp/` خوارزميات الصوت (pitch.js, denoise.js, wav.js)
- `src/audio/engine.js` التسجيل والتشغيل وسلسلة التأثيرات والتصدير
- `src/App.jsx` الواجهة
- `.github/workflows/android.yml` بناء ملف APK تلقائياً على GitHub

## بناء الـ APK من الموبايل (بدون ما تثبت أي حاجة)
1. افتح github.com وأنشئ مستودع (Repository) جديد باسم `voice-studio`.
2. افتح **Codespaces** على المستودع (زرار Code ثم Codespaces) من متصفح الموبايل.
3. ارفع ملف الـ zip في مستكشف الملفات، ومن الـ Terminal اكتب:
   ```
   unzip voice-studio.zip -d . && git add -A && git commit -m "init" && git push origin HEAD:main
   ```
4. افتح تبويب **Actions** وانتظر انتهاء "Build Android APK" (حوالي 5 إلى 10 دقائق).
5. من صفحة التشغيل نزّل الـ artifact باسم `voice-studio-apk` وفك الضغط وثبّت `app-debug.apk` (فعّل "التثبيت من مصادر غير معروفة").

## تشغيل تجريبي على الكمبيوتر
```
npm install
npm run dev
```

## ملاحظات
- الميكروفون: يطلب التطبيق الإذن عند أول تسجيل.
- التصدير: يفتح قائمة المشاركة لحفظ ملف WAV.
- المعالجة تتم بعد التسجيل (مش لحظية). للغناء مع سماع الأوتوتيون لحظياً نحتاج Plugin أصلي بـ C++ (Oboe) في مرحلة لاحقة.

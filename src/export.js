import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

function toBase64(bytes) {
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(bin);
}

// على أندرويد: يكتب الملف ويفتح قائمة المشاركة/الحفظ. على المتصفح: تنزيل عادي.
export async function saveWav(bytes, name) {
  if (Capacitor.isNativePlatform()) {
    const r = await Filesystem.writeFile({ path: name, data: toBase64(bytes), directory: Directory.Cache });
    await Share.share({ title: name, url: r.uri, dialogTitle: 'حفظ الصوت' });
  } else {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  }
}

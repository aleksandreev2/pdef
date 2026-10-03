/**
 * Загрузка PT Serif и PT Sans в assets/fonts.
 *
 *   npm run fonts
 *
 * Без них приложение работает на системных кириллических шрифтах
 * (Georgia + Segoe UI на Windows), но спецификация просит именно PT.
 * Шрифты распространяются по SIL Open Font License 1.1.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', 'assets', 'fonts');

const BASE = 'https://raw.githubusercontent.com/google/fonts/main/ofl';

const FILES = [
  ['ptserif/PT_Serif-Web-Regular.ttf', 'PTSerif-Regular.ttf'],
  ['ptserif/PT_Serif-Web-Bold.ttf', 'PTSerif-Bold.ttf'],
  ['ptserif/PT_Serif-Web-Italic.ttf', 'PTSerif-Italic.ttf'],
  ['ptserif/PT_Serif-Web-BoldItalic.ttf', 'PTSerif-BoldItalic.ttf'],
  ['ptsans/PT_Sans-Web-Regular.ttf', 'PTSans-Regular.ttf'],
  ['ptsans/PT_Sans-Web-Bold.ttf', 'PTSans-Bold.ttf'],
  ['ptsans/PT_Sans-Web-Italic.ttf', 'PTSans-Italic.ttf'],
  ['ptsans/PT_Sans-Web-BoldItalic.ttf', 'PTSans-BoldItalic.ttf'],
  ['ptserif/OFL.txt', 'OFL-PTSerif.txt'],
  ['ptsans/OFL.txt', 'OFL-PTSans.txt'],
];

await fs.mkdir(outDir, { recursive: true });

let ok = 0;
for (const [remote, local] of FILES) {
  const target = path.join(outDir, local);
  try {
    await fs.access(target);
    console.log(`уже есть: ${local}`);
    ok += 1;
    continue;
  } catch {
    /* файла нет — качаем */
  }

  const url = `${BASE}/${remote}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < (local.endsWith('.ttf') ? 10000 : 1000)) throw new Error('файл подозрительно мал');
    await fs.writeFile(target, buf);
    console.log(`загружено: ${local} (${(buf.length / 1024).toFixed(0)} КБ)`);
    ok += 1;
  } catch (e) {
    console.error(`не удалось загрузить ${local}: ${e.message}`);
  }
}

console.log(`\nГотово: ${ok} из ${FILES.length}. Папка: ${outDir}`);
if (ok < FILES.length) {
  console.log('Недостающие начертания можно положить вручную — имена выше.');
  process.exitCode = 1;
}

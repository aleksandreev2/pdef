'use strict';

/**
 * Упаковка приложения в ZIP для передачи.
 *
 *   npm run pack              — исходники + шрифты, без node_modules
 *   npm run pack -- --no-fonts  — без шрифтов (их докачает npm run fonts)
 *   npm run pack -- --out <папка>
 *
 * node_modules в архив не кладётся: получатель выполняет npm install.
 */

const fs = require('fs/promises');
const path = require('path');
const JSZip = require('jszip');

const root = path.join(__dirname, '..');

/** Что входит в архив. */
const INCLUDE = ['src', 'scripts', 'assets', 'package.json', 'package-lock.json', 'README.md', '.gitignore'];

/** Что не входит никогда. */
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'out', '.cache']);
const SKIP_FILES = /(^|[\\/])(\.DS_Store|Thumbs\.db|desktop\.ini|.*\.log)$/i;

function parseArgs(argv) {
  const out = { fonts: true, outDir: path.join(require('os').homedir(), 'Desktop') };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--no-fonts') out.fonts = false;
    else if (argv[i] === '--out') out.outDir = argv[++i];
  }
  return out;
}

const INSTALL_NOTE = `PDFMaker Mobile — установка
===========================

Сборка мобильного PDF и EPUB 3 из отдельных глав (TXT, DOCX, Google Docs DOCX).

ЧТО НУЖНО
---------
Node.js 20 или новее — https://nodejs.org (обычная установка, «Next» до конца).

ЗАПУСК
------
1. Распакуйте папку PDFMaker в любое место, где есть права на запись
   (например, на Рабочий стол или в Документы).
2. Откройте эту папку, нажмите в адресной строке проводника и впишите cmd,
   затем Enter — откроется командная строка в этой папке.
3. Выполните одну за другой две команды:

       npm install
       npm start

Первая команда ставит зависимости (нужен интернет; Electron весит около
190 МБ, поэтому установка может занять и двадцать минут), вторая открывает
приложение. В дальнейшем достаточно только npm start.

Если в конце установки npm напишет, что пропустил install scripts у electron,
выполните две команды и повторите запуск:

       npm approve-scripts electron
       npm install

ШРИФТЫ
------
Если в папке assets/fonts нет файлов PTSerif-*.ttf и PTSans-*.ttf, выполните:

       npm run fonts

Без них приложение работает на системных кириллических шрифтах
(на Windows — Georgia и Segoe UI) и пишет об этом в отчёте.

КАК ПОЛЬЗОВАТЬСЯ
----------------
1. Перетащите в окно главы: файлы, папку целиком или ZIP-архив.
2. Впишите название книги; команда перевода и ссылка уже заполнены.
3. Проверьте вкладку «Аудит»: пропуски в нумерации, дубли, пустые файлы.
4. Выберите обложку — акцентный цвет подберётся из неё сам.
5. Укажите папку для готовых файлов и нажмите «Собрать книгу».
6. После сборки откройте «Отчёт» (проверки) и «Предпросмотр» (вид страниц
   в мобильной ширине).

СБОРКА БЕЗ ИНТЕРФЕЙСА
---------------------
       node scripts/cli.js --in <папка|zip> --out <папка> --title "Название"

Подробности — в README.md.
`;

async function walk(dir, base, onFile) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(full, base, onFile);
    } else if (!SKIP_FILES.test(entry.name)) {
      await onFile(full, rel);
    }
  }
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const folder = `PDFMaker-Mobile-${pkg.version}`;

  const zip = new JSZip();
  let count = 0;
  let fontCount = 0;

  const add = async (full, rel) => {
    if (!args.fonts && /^assets\/fonts\/.*\.(ttf|otf)$/i.test(rel)) return;
    if (/^assets\/fonts\/.*\.(ttf|otf)$/i.test(rel)) fontCount += 1;
    const data = await fs.readFile(full);
    zip.file(`${folder}/${rel}`, data);
    count += 1;
  };

  for (const item of INCLUDE) {
    const full = path.join(root, item);
    let stat;
    try {
      stat = await fs.stat(full);
    } catch {
      continue; // package-lock.json может отсутствовать
    }
    if (stat.isDirectory()) await walk(full, root, add);
    else await add(full, item);
  }

  // BOM: без него русский текст в .txt открывается кракозябрами
  // в редакторах Windows, которые по умолчанию считают файл ANSI.
  zip.file(`${folder}/УСТАНОВКА.txt`, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(INSTALL_NOTE.replace(/\n/g, '\r\n'), 'utf8')]));
  count += 1;

  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });

  await fs.mkdir(args.outDir, { recursive: true });
  const outPath = path.join(args.outDir, `${folder}.zip`);
  await fs.writeFile(outPath, buffer);

  console.log(`Архив: ${outPath}`);
  console.log(`Файлов: ${count}${fontCount ? ` (из них шрифтов: ${fontCount})` : ', шрифты не включены'}`);
  console.log(`Размер: ${(buffer.length / 1048576).toFixed(2)} МБ`);
})().catch((e) => {
  console.error('ОШИБКА:', e.message);
  process.exit(1);
});

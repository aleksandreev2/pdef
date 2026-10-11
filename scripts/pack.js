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
const INCLUDE = ['src', 'scripts', 'assets', 'build', 'docs', 'tests', '.github', 'package.json', 'package-lock.json', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'CHANGELOG.md', 'CONTRIBUTING.md', '.gitignore'];

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

const INSTALL_NOTE = "PDFMaker Mobile — установка\n===========================\n\nОБЫЧНАЯ УСТАНОВКА НА WINDOWS\n---------------------------\n1. Откройте https://github.com/aleksandreev2/pdef/releases/latest\n2. Скачайте PDFMaker-Mobile-3.3.0-Setup.exe и запустите его.\n\nWindows 10/11, 64 бит. Шрифты, библиотеки и Calibre уже включены.\nNode.js и консоль для установленной программы не нужны.\n\nЗАПУСК ИЗ ЭТОГО АРХИВА ИСХОДНИКОВ\n--------------------------------\nНужен Node.js 20 или новее: https://nodejs.org\nРаспакуйте архив в папку с правом записи. Откройте терминал в этой папке:\n\n    npm ci\n    npm run fonts\n    npm start\n\nДля экспорта MOBI/AZW3 из исходников установите Calibre или выполните\nв Windows: npm run kindle-tools\n\nПЕРВАЯ КНИГА\n------------\n1. Перетащите главы, папку или ZIP в приложение.\n2. Укажите название, команду перевода и обложку.\n3. Проверьте «Аудит»: порядок, пропуски, пустые файлы и дубли.\n4. Выберите оформление, форматы, иллюстрации и папку вывода.\n5. Нажмите «Собрать книгу», откройте «Отчёт» и «Предпросмотр».\n\nОБНОВЛЕНИЕ\n----------\nС версии 3.3.0 приложение сообщает о новых релизах GitHub.\n«Обновить» скачивает и проверяет установщик, затем запускает установку.\nСохраните результаты перед обновлением: приложение закроется.\nНастройки установленной программы сохраняются.\n\nПодробности: README.md, docs/guide.md, docs/development.md.\nКод: MIT (LICENSE). Сторонние компоненты: THIRD_PARTY_NOTICES.md.\n";

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

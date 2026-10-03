'use strict';

/**
 * Сборка из командной строки — тот же пайплайн, что и в приложении.
 *
 *   node scripts/cli.js --in <путь|zip> [...] --out <папка> --title "Название"
 *                       [--team "Дом Некроманта"] [--url <ссылка>]
 *                       [--accent "#6E5A7B"] [--only pdf|epub]
 */

const path = require('path');
const { analyze, build } = require('../src/core/pipeline');

function parseArgs(argv) {
  const args = { in: [], out: process.cwd(), title: '', team: '', url: '', accent: '', only: '', genre: 'fantasy' };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[(i += 1)];
    if (a === '--in') {
      while (argv[i + 1] && !argv[i + 1].startsWith('--')) args.in.push(next());
    } else if (a === '--out') args.out = next();
    else if (a === '--title') args.title = next();
    else if (a === '--team') args.team = next();
    else if (a === '--url') args.url = next();
    else if (a === '--accent') args.accent = next();
    else if (a === '--genre') args.genre = next();
    else if (a === '--only') args.only = next();
  }
  return args;
}

function bar(p) {
  if (!p.total) return p.label;
  const pct = Math.round((p.done / p.total) * 100);
  return `${p.label} — ${pct}%`;
}

(async () => {
  const args = parseArgs(process.argv);
  if (!args.in.length) {
    console.error('Укажите --in <путь к папке, zip или файлам>');
    process.exit(1);
  }

  let last = '';
  const onProgress = (p) => {
    const line = bar(p);
    if (line !== last) {
      process.stdout.write(`\r${' '.repeat(Math.max(0, last.length))}\r${line}`);
      last = line;
    }
  };

  const t0 = Date.now();
  const analysis = await analyze(args.in, onProgress);
  process.stdout.write('\n');

  const a = analysis.audit;
  console.log(`Файлов разобрано: ${a.total}, в книгу входит: ${a.included}`);
  console.log(`Главы: ${a.chapters}, доп. разделы: ${a.extras.length}`);
  console.log(`Нумерация: ${a.firstNumber}–${a.lastNumber}, пропусков: ${a.gaps.length}${a.gaps.length ? ` (${a.gaps.slice(0, 20).join(', ')})` : ''}`);
  console.log(`Дублей: ${a.duplicates.length}, пустых: ${a.empty.length}, повреждённых: ${a.broken.length}`);
  console.log(`Иллюстраций: ${a.images.total} (в главах ${a.images.inChapters}, в галерее ${a.images.gallery})`);
  console.log(`Кодировки TXT: ${Object.keys(a.encodings).length ? JSON.stringify(a.encodings) : '— (TXT нет)'}`);
  console.log(
    `Слова: ${analysis.stats.words}, с заголовками: ${analysis.stats.wordsWithHeadings}, системных блоков: ${analysis.stats.systemBlocks}`,
  );
  if (analysis.warnings.length) console.log('Предупреждения:', analysis.warnings.slice(0, 5));
  if (analysis.fonts.length) console.log('Шрифты:', analysis.fonts);
  console.log(`Анализ: ${((Date.now() - t0) / 1000).toFixed(1)} с\n`);

  const report = await build(
    {
      meta: {
        title: args.title || analysis.suggestedTitle || 'Книга',
        team: args.team || 'Дом Некроманта',
        teamUrl: args.url || 'https://ranobelib.me/ru/team/11969--dom-nekromanta',
      },
      style: { genre: args.genre, ...(args.accent ? { accent: args.accent } : {}) },
      outDir: path.resolve(args.out),
      formats: { pdf: args.only !== 'epub', epub: args.only !== 'pdf' },
    },
    onProgress,
  );
  process.stdout.write('\n');

  console.log(`\nГотово за ${((Date.now() - t0) / 1000).toFixed(1)} с`);
  if (report.pdf) {
    console.log(`PDF:  ${report.pdf.path}`);
    console.log(`      страниц ${report.pdf.pages}, оглавление ${report.pdf.tocPages} стр., закладок ${report.pdf.bookmarks}, ${(report.pdf.size / 1048576).toFixed(2)} МБ`);
  }
  if (report.epub) {
    console.log(`EPUB: ${report.epub.path}`);
    console.log(`      документов ${report.epub.documents}, изображений ${report.epub.images}, ${(report.epub.size / 1048576).toFixed(2)} МБ`);
  }

  for (const [kind, qa] of Object.entries(report.qa)) {
    if (!qa) continue;
    console.log(`\n${kind.toUpperCase()} QA: ${qa.ok ? 'пройден' : 'ЕСТЬ ЗАМЕЧАНИЯ'}`);
    for (const c of qa.checks) {
      if (!c.ok) console.log(`  ✗ ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
    }
    for (const n of qa.notes || []) console.log(`  · ${n}`);
  }
  if (report.pdf && report.pdf.warnings.length) console.log('\nPDF warnings:', report.pdf.warnings.slice(0, 8));
  if (report.epub && report.epub.warnings.length) console.log('EPUB warnings:', report.epub.warnings.slice(0, 8));
})().catch((e) => {
  console.error('\nОШИБКА:', e.message);
  console.error(e.stack);
  process.exit(1);
});

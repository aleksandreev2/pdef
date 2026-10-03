'use strict';

// Реальные образцы PDF и EPUB для проверки всех профилей оформления.
// node scripts/genre-samples.js --out <папка>
const path = require('path');
const fs = require('fs/promises');
const { GENRES } = require('../src/core/genres');
const { clampStyle } = require('../src/core/style');
const { resolveFonts } = require('../src/core/fonts');
const { makeBook, makeChapter } = require('../src/core/model');
const { computeStats } = require('../src/core/stats');
const { buildPdf } = require('../src/core/pdf/build');
const { buildEpub } = require('../src/core/epub/build');
const { checkPdf } = require('../src/core/qa/pdf');
const { checkEpub } = require('../src/core/qa/epub');

async function main() {
  const arg = process.argv.indexOf('--out');
  const out = path.resolve(arg >= 0 ? process.argv[arg+1] : 'output/genre-samples');
  await fs.mkdir(out, { recursive: true });
  const book = makeBook();
  book.title = 'Начало пути';
  book.chapters = [makeChapter({ id: 'ch1', number: 1, title: 'Начало пути', blocks: [
    { type: 'para', align: 'left', runs: [{ text: 'За окном медленно светало.' }] },
    { type: 'para', align: 'left', runs: [{ text: 'Он остановился у двери' }] },
    { type: 'para', align: 'left', runs: [{ text: 'и прислушался к тишине.' }] },
    { type: 'sep', text: '──────────' },
    { type: 'para', align: 'center', runs: [{ text: 'Впереди начиналась' }] },
    { type: 'para', align: 'center', runs: [{ text: 'новая история.' }] },
    { type: 'system', lines: [[{ text: 'Запись', b: true }], [{ text: 'Открыта новая глава.' }]] },
  ] })];
  book.stats = computeStats(book.chapters);
  const reports = [];
  for (const genre of GENRES) {
    const style = clampStyle({ genre: genre.id });
    const pdfPath = path.join(out, genre.id+'.pdf');
    const epubPath = path.join(out, genre.id+'.epub');
    const pdf = await buildPdf({ book, style, fonts: resolveFonts(style), outPath: pdfPath });
    await buildEpub({ book, style, outPath: epubPath });
    const expected = { sections: 1, tocPages: pdf.tocPages, tocFirstPage: pdf.tocFirstPage, chapterPages: pdf.chapterPages, firstContentPage: pdf.firstContentPage };
    const pdfQa = await checkPdf(pdfPath, { book, expected });
    const epubQa = await checkEpub(epubPath, { book, expected });
    const failures = [...pdfQa.checks, ...epubQa.checks].filter(c => !c.ok);
    reports.push({ genre: genre.id, pages: pdf.pages, firstContentPage: pdf.firstContentPage, failures, notes: epubQa.notes });
    console.log(genre.name+': '+pdf.pages+' стр.; замечаний: '+failures.length);
  }
  await fs.writeFile(path.join(out, 'checks.json'), JSON.stringify(reports, null, 2));
  if (reports.some(r => r.failures.length)) process.exitCode = 1;
}
main().catch(e => { console.error(e); process.exitCode = 1; });

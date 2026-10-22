'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { buildPdf } = require('../src/core/pdf/build');
const { resolveFonts } = require('../src/core/fonts');
const { makeBook, makeChapter } = require('../src/core/model');
const { clampStyle } = require('../src/core/style');

test('PDF document outline opens each section on its own page', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfmaker-bookmarks-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const book = makeBook();
  book.title = 'Проверка закладок';
  book.chapters = ['Первая', 'Вторая', 'Третья'].map((title, i) => makeChapter({
    id: `chapter-${i + 1}`,
    number: i + 1,
    title,
    blocks: [{ type: 'para', runs: [{ text: `Текст раздела ${i + 1}.` }] }],
  }));
  const style = clampStyle({});
  const outPath = path.join(dir, 'book.pdf');
  await buildPdf({ book, style, fonts: resolveFonts(style), outPath });

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(await fs.readFile(outPath)),
    useSystemFonts: false,
    isEvalSupported: false,
  }).promise;
  try {
    const outline = await doc.getOutline();
    const destinations = await Promise.all(outline.map(async (item) => {
      const dest = typeof item.dest === 'string' ? await doc.getDestination(item.dest) : item.dest;
      return [item.title, (await doc.getPageIndex(dest[0])) + 1];
    }));
    assert.deepEqual(destinations, [
      ['Титульная страница', 2],
      ['Оглавление', 3],
      ['О переводе', 4],
      ['001. Первая', 5],
      ['002. Вторая', 6],
      ['003. Третья', 7],
    ]);
  } finally {
    await doc.destroy();
  }
});

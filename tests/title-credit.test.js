'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {buildPdf} = require('../src/core/pdf/build');
const {makeBook} = require('../src/core/model');
const {clampStyle, geometry} = require('../src/core/style');
const {resolveFonts} = require('../src/core/fonts');

async function titlePage(t, overrides = {}, team = 'Дом Некроманта') {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf-title-credit-'));
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const book = makeBook();
  Object.assign(book, {
    title: 'Я стал психиатром, которым одержимы охотники', team,
    teamUrl: 'https://example.test/translators', stats: {words: 549664, chapters: 385},
  });
  const style = clampStyle(overrides);
  const outPath = path.join(dir, 'book.pdf');
  await buildPdf({book, style, fonts: resolveFonts(style), outPath});
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({data: new Uint8Array(await fs.readFile(outPath)), isEvalSupported: false}).promise;
  t.after(() => pdf.destroy());
  const page = await pdf.getPage(2);
  const {items} = await page.getTextContent();
  return {items: items.filter(i => i.str.trim()), annotations: await page.getAnnotations(), geom: geometry(style)};
}

test('PDF title page credits the application with a visible clickable repository link', async t => {
  const {items, annotations} = await titlePage(t, {genre: 'erotica'});
  const text = items.map(i => i.str).join(' ');
  assert.match(text, /PDFMaker Mobile/);
  assert.match(text, /github\.com\/aleksandreev2\/pdef/);
  const links = annotations.filter(a => a.url === 'https://github.com/aleksandreev2/pdef');
  assert.ok(links.length >= 1, 'repository has a real PDF Link annotation on the title');
  const address = items.find(i => i.str.includes('github.com/aleksandreev2/pdef'));
  assert.ok(links.some(a => a.rect[0] <= address.transform[4] + 1 && a.rect[2] >= address.transform[4] + address.width - 1), 'the visible address is clickable');
  assert.ok(annotations.some(a => a.url === 'https://example.test/translators'), 'translation credit remains linked');
});

test('title credits stay within margins and do not overlap with a large wrapped translation credit', async t => {
  const {items, annotations, geom} = await titlePage(t, {signature: false, creditBottomMm: 0, creditSize: 16},
    'Длинное название команды перевода, которое занимает несколько строк на титульной странице');
  assert.match(items.map(i => i.str).join(' '), /PDFMaker Mobile/);
  for (const item of items) {
    const x = item.transform[4], y = item.transform[5];
    assert.ok(x >= geom.contentX - .5 && x + item.width <= geom.contentX + geom.contentW + .5, 'horizontal bounds: ' + item.str);
    assert.ok(y >= geom.bottom && y + item.height <= geom.pageH - geom.top + .5, 'vertical bounds: ' + item.str);
  }
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i], b = items[j];
    const dx = Math.min(a.transform[4] + a.width, b.transform[4] + b.width) - Math.max(a.transform[4], b.transform[4]);
    const dy = Math.min(a.transform[5] + a.height, b.transform[5] + b.height) - Math.max(a.transform[5], b.transform[5]);
    assert.ok(dx <= 1 || dy <= 2, 'overlap: ' + a.str + ' / ' + b.str);
  }
  const links = annotations.filter(a => a.url === 'https://example.test/translators');
  assert.ok(links.length >= 2, 'each wrapped translator line remains clickable');
});

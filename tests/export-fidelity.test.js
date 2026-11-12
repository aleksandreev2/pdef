'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const JSZip = require('jszip');
const PDFDocument = require('pdfkit');
const { makeBook, makeChapter } = require('../src/core/model');
const { clampStyle } = require('../src/core/style');
const { resolveFonts } = require('../src/core/fonts');
const { buildEpub } = require('../src/core/epub/build');
const { buildFb2 } = require('../src/core/export/fb2');
const { checkEpub } = require('../src/core/qa/epub');
const { checkExport } = require('../src/core/qa/exports');
const { checkPdf } = require('../src/core/qa/pdf');
const { drawLine } = require('../src/core/pdf/render');
const { createMeasurer, FONT } = require('../src/core/pdf/typeset');
const { createEpubGlyphs } = require('../src/core/epub/media');

const style = clampStyle({ signature: false });
const fonts = resolveFonts(style);

async function fixture(t, format) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdef-fidelity-test-'));
  const file = path.join(dir, 'book.' + format);
  t.after(async () => {
    await fs.rm(file, { force: true });
    await fs.rmdir(dir);
  });
  const book = makeBook();
  book.title = 'Test title';
  book.chapters = [
    makeChapter({
      id: 'chapter-a',
      title: 'First title',
      blocks: [
        { type: 'para', runs: [{ text: 'First paragraph & a ' }, { text: '🤨', b: true }] },
        { type: 'para', runs: [{ text: 'Second paragraph in chapter A.' }] },
      ],
    }),
    makeChapter({
      id: 'chapter-b',
      title: 'Second title',
      blocks: [
        { type: 'para', runs: [{ text: 'First paragraph in chapter B.' }] },
        { type: 'system', lines: [[{ text: 'System line 1' }], [{ text: 'System line 2' }]] },
        { type: 'list', ordered: true, items: [[{ text: 'Item A' }], [{ text: 'Item B' }]] },
      ],
    }),
  ];
  return { book, file };
}

async function editChapter(file, edit) {
  const zip = await JSZip.loadAsync(await fs.readFile(file));
  const entry = 'EPUB/text/ch001.xhtml';
  const chapter = await zip.file(entry).async('string');
  zip.file(entry, edit(chapter));
  await fs.writeFile(file, await zip.generateAsync({ type: 'nodebuffer' }));
}

test('EPUB QA compares complete chapters and restores rendered emoji from alt', async t => {
  const { book, file } = await fixture(t, 'epub');
  await buildEpub({ book, style, fonts, outPath: file });
  const expected = { sections: 2 };
  assert.equal((await checkEpub(file, { book, expected })).ok, true);
  await editChapter(file, chapter => chapter.replace('<p>Second paragraph in chapter A.</p>', ''));
  assert.equal((await checkEpub(file, { book, expected })).ok, false);
});

test('EPUB QA decodes XML entities in team name and hyperlink', async t => {
  const { book, file } = await fixture(t, 'epub');
  book.team = 'A & B';
  book.teamUrl = 'https://example.test/?x=1&y=2';
  await buildEpub({ book, style, fonts, outPath: file });
  const result = await checkEpub(file, { book, expected: { sections: 2 } });
  assert.equal(result.ok, true, JSON.stringify(result.checks.filter(check => !check.ok)));
});

test('FB2 QA compares complete chapters and restores compatibility glyphs', async t => {
  const { book, file } = await fixture(t, 'fb2');
  await buildFb2({ book, style, fonts, compatibility: true, outPath: file });
  const options = { book, format: 'fb2', fb2Compatibility: true };
  assert.equal((await checkExport(file, options)).ok, true);
  const original = await fs.readFile(file, 'utf8');
  await fs.writeFile(file, original.replace('<p>Second paragraph in chapter A.</p>', ''));
  assert.equal((await checkExport(file, options)).ok, false);
});

test('PDF QA rejects a standard font without an embedded font program', async t => {
  const { book, file } = await fixture(t, 'pdf');
  const doc = new PDFDocument();
  const chunks = [];
  doc.on('data', chunk => chunks.push(chunk));
  const done = new Promise(resolve => doc.on('end', resolve));
  doc.font('Helvetica').text('This PDF has no embedded font program.');
  doc.end();
  await done;
  await fs.writeFile(file, Buffer.concat(chunks));
  const result = await checkPdf(file, { book, expected: { sections: 2, firstContentPage: 1 } });
  const embeddedFontCheck = result.checks.find(check => check.name.includes('Шрифты встроены'));
  assert.equal(embeddedFontCheck?.ok, false);
});

test('EPUB renders BMP emoji sequences and leaves text-style symbols as text', () => {
  const { markup } = createEpubGlyphs(fonts);
  const escape = text => text;
  assert.match(markup('❤️ 1️⃣', escape), /alt="❤️"\/> <img[^>]+alt="1️⃣"/u);
  assert.equal(markup('❤︎ ©', escape), '❤︎ ©');
});

test('PDF line rendering reuses the width of a single-font line', () => {
  const doc = new PDFDocument();
  const { width, parts } = createMeasurer(doc, fonts);
  const sentence = 'This example line exceeds the width cache threshold and should be measured once in our renderer.';
  const words = sentence.split(' ');
  const sizes = [];
  let x = 0;
  const items = words.map((word, index) => {
    const w = width(word, FONT.serif, 12);
    const item = { text: word, fontKey: FONT.serif, fmt: {}, x, w, spaceAfter: index < words.length - 1 };
    x += w + 3;
    return item;
  });
  drawLine(doc, { items }, 0, 0, 12, 'black', {
    measure: (value, ...args) => {
      if (value === sentence) sizes.push(value);
      return width(value, ...args);
    },
    fontParts: parts,
  });
  doc.end();
  assert.equal(sizes.length, 1);
});

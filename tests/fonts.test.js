'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const PDFDocument = require('pdfkit');
const { resolveFonts } = require('../src/core/fonts');
const { createMeasurer } = require('../src/core/pdf/typeset');
const { drawLine } = require('../src/core/pdf/render');
const { analyze, build } = require('../src/core/pipeline');
test('CJK text uses an available fallback font without replacing its characters', { skip: !fs.existsSync('C:/Windows/Fonts/malgun.ttf') }, () => {
  const doc = new PDFDocument({ autoFirstPage: false });
  const measure = createMeasurer(doc, resolveFonts());
  assert.equal(typeof measure.parts, 'function');
  const parts = measure.parts('Сфера (怨氣玉)', 'sans');
  assert.equal(parts.map(p => p.text).join(''), 'Сфера (怨氣玉)');
  assert.ok(parts.some(p => p.fontKey === 'fallback' && p.text === '怨氣玉'));
});
test('justified PDF preserves the space after a fallback-font word', { skip: !fs.existsSync('C:/Windows/Fonts/malgun.ttf') }, async () => {
  const doc = new PDFDocument({ margin: 0 });
  const measure = createMeasurer(doc, resolveFonts());
  const texts = ['Перед', '怨氣玉', 'после.'];
  const size = 11.5;
  const gap = measure.width(' ', 'serif', size) + 5;
  let x = 20;
  const items = texts.map(text => {
    const item = { text, x, w: measure.width(text, 'serif', size), fontKey: 'serif', fmt: {}, spaceAfter: true };
    x += item.w + gap;
    return item;
  });
  items[2].spaceAfter = false;
  const chunks = [];
  doc.on('data', b => chunks.push(b));
  const done = new Promise(resolve => doc.on('end', resolve));
  drawLine(doc, { items }, 0, 30, size, '#141414', { measure: measure.width, fontParts: measure.parts });
  doc.end();
  await done;
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(Buffer.concat(chunks)), isEvalSupported: false }).promise;
  const page = await pdf.getPage(1);
  const content = await page.getTextContent();
  const after = content.items.find(it => it.str.includes('после.'));
  assert.ok(after, 'Russian text remains searchable');
  assert.ok(Math.abs(after.transform[4] - items[2].x) < 0.1, `${after.transform[4]} versus ${items[2].x}`);
  await pdf.destroy();
});

async function exportSample(t, text) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'pdfmaker-glyphs-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, '001.txt');
  await fsp.writeFile(source, `Глава 1. Проверка шрифтов\n\n${text}\n`);
  await analyze([source]);
  const report = await build({ meta: {}, outDir: dir, formats: { pdf: true, epub: false } });
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(await fsp.readFile(report.pdf.path)),
    useSystemFonts: false,
    isEvalSupported: false,
  }).promise;
  t.after(() => pdf.destroy());
  const page = await pdf.getPage(pdf.numPages);
  const content = await page.getTextContent({ disableNormalization: true });
  return { text: content.items.map(item => item.str).join('').replace(/ /g, ''), warnings: report.pdf.warnings };
}

test('PDF embeds searchable emoji from chat lines and keeps joined emoji together', async (t) => {
  const text = '[002] — 🤨🤔😮🫠 👩🏽‍💻';
  const result = await exportSample(t, text);
  assert.ok(result.text.includes('[002]—🤨🤔😮🫠👩🏽‍💻'), JSON.stringify(result.text));
});

test('PDF preserves rare geometric, Egyptian and Batak symbols', async (t) => {
  const result = await exportSample(t, 'Текст ⏳✧𓏸ᯅ конец');
  assert.ok(result.text.includes('Текст⏳✧𓏸ᯅконец'), JSON.stringify(result.text));
});

test('PDF warns once per Unicode value when no font can display a character', async (t) => {
  const result = await exportSample(t, 'Текст \u{10FFFF}\u{10FFFF} конец');
  const warning = result.warnings.find(message => message.includes('U+10FFFF'));
  assert.ok(warning, result.warnings.join('\n'));
  assert.equal(warning.match(/U\+10FFFF/g).length, 1);
});

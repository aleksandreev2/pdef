'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const JSZip = require('jszip');
const { importSources } = require('../src/core/import');
const { parseDocx } = require('../src/core/import/docx');
const { parseFb2Stream } = require('../src/core/import/fb2');
const { decodeText } = require('../src/core/import/txt');
const { auditChapters, auditWarnings } = require('../src/core/audit');
const { blockText } = require('../src/core/model');

async function fixture(t, files) {
  const folder = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'pdfmaker-import-test-'));
  t.after(async () => {
    for (const name of Object.keys(files)) await fs.unlink(path.join(folder, name));
    await fs.rmdir(folder);
  });
  for (const [name, data] of Object.entries(files)) await fs.writeFile(path.join(folder, name), data);
  return folder;
}

function fb2(labels) {
  return '<FictionBook><body>' + labels.map(label =>
    `<section><title><p>${label}</p></title><p>Body of ${label}.</p></section>`
  ).join('') + '</body></FictionBook>';
}

test('the TXT decoder preserves valid UTF-8 without a BOM', () => {
  for (const text of ['One paragraph 🎉 with an emoji.', 'Café déjà vu — Noël.', '漢字の本を読む。']) {
    assert.deepEqual(decodeText(Buffer.from(text)), { text, encoding: 'utf-8', guessConfidence: 1 });
  }
});

test('FB2 recognizes a consistent space-separated chapter sequence and keeps unrelated numeric titles', async t => {
  const folder = await fixture(t, { 'book.fb2': fb2(['1 First', '2 Second', '1984', '4 Fourth', '5 Fifth', '1984 in Berlin']) });
  const { chapters } = await importSources([folder]);
  assert.deepEqual(chapters.map(c => [c.number, c.title, c.blocks.map(blockText)]), [
    [1, 'First', ['Body of 1 First.']],
    [2, 'Second', ['Body of 2 Second.']],
    [null, '1984', ['Body of 1984.']],
    [4, 'Fourth', ['Body of 4 Fourth.']],
    [5, 'Fifth', ['Body of 5 Fifth.']],
    [null, '1984 in Berlin', ['Body of 1984 in Berlin.']],
  ]);
  assert.deepEqual(auditChapters(chapters).gaps, [3]);
});

test('FB2 book metadata with a numeric title remains a title', async t => {
  const folder = await fixture(t, { 'book.fb2': '<FictionBook><description><title-info><book-title>1984</book-title></title-info></description><body><p>Text.</p></body></FictionBook>' });
  const book = await importSources([folder]);
  assert.deepEqual(book.chapters.map(c => [c.number, c.title]), [[null, '1984']]);
});

test('FB2 stream preserves XML entities, Unicode, and images split across byte chunks', async () => {
  const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
  const xml = '<FictionBook xmlns:l="http://www.w3.org/1999/xlink"><body><section><title><p>Глава 1. Рассвет</p></title><p>Эмодзи 🎉 &amp; текст.</p><image l:href="#pixel"/></section></body><binary id="pixel" content-type="image/png">' + pixel + '</binary></FictionBook>';
  const bytes = Buffer.from(xml);
  async function* chunks() {
    for (let i = 0; i < bytes.length; i += 3) yield bytes.subarray(i, i + 3);
  }
  const parsed = await parseFb2Stream(chunks(), (data, ext) => {
    assert.deepEqual(data, Buffer.from(pixel, 'base64'));
    assert.equal(ext, 'png');
    return 'picture';
  });
  assert.equal(parsed.sections[0].rawParas[1].runs.map(r => r.text).join(''), 'Эмодзи 🎉 & текст.');
  assert.equal(parsed.sections[0].rawParas[2].image.assetId, 'picture');
});

test('a broken ZIP in a selected folder does not hide the other chapters', async t => {
  const folder = await fixture(t, { '000-broken.zip': 'invalid ZIP', '002.txt': 'A valid chapter.' });
  const book = await importSources([folder]);
  assert.deepEqual(book.chapters.map(c => c.number), [2]);
  assert.ok(book.warnings.some(w => w.includes('000-broken.zip')));
});

test('an explicit Markdown chapter heading is accepted and a longer gallery title keeps its number', async t => {
  const folder = await fixture(t, {
    'opaque.md': '# 002. Beyond\nOrdinary prose.',
    '004.txt': 'Chapter 4. Gallery at dawn\nOrdinary prose.',
  });
  const { chapters } = await importSources([folder]);
  assert.deepEqual(chapters.map(c => [c.number, c.title, c.blocks.map(blockText)]), [
    [2, 'Beyond', ['Ordinary prose.']],
    [4, 'Gallery at dawn', ['Ordinary prose.']],
  ]);
});

test('distinct native FB2 sections sharing a title do not trigger a duplicate warning', async t => {
  const xml = '<FictionBook><body><section><title><p>At home</p></title><p>It was early.</p></section><section><title><p>At home</p></title><p>It was late.</p></section></body></FictionBook>';
  const folder = await fixture(t, { 'book.fb2': xml });
  const { chapters } = await importSources([folder]);
  assert.deepEqual(auditWarnings(auditChapters(chapters)), []);
});

test('the audit distinguishes exact copies inside a group of alternate chapter versions', async t => {
  const folder = await fixture(t, {
    '001. One.txt': 'A first version.',
    '001. Two.txt': 'A first version.',
    '001. Three.txt': 'A different version.',
  });
  const { chapters } = await importSources([folder]);
  const audit = auditChapters(chapters);
  assert.equal(audit.duplicates[0].identical, false);
  assert.deepEqual(audit.duplicates[0].exactCopies.map(group => group.map(version => version.file)), [
    ['001. One.txt', '001. Two.txt'],
  ]);
  assert.ok(chapters.find(ch => ch.sourceName === '001. One.txt').issues.includes('Совпадение глав: точный дубль'));
});

async function docx(body) {
  const zip = new JSZip();
  zip.file('word/document.xml', body);
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('DOCX reports a truncated main XML document', async () => {
  const invalid = await docx('<w:document><w:body><w:p><w:r><w:t>First.</w:t></w:r></w:p><w:p><w:r><w:t>Truncated');
  await assert.rejects(parseDocx(invalid, () => null), /XML DOCX/);
});

test('DOCX imports visible content controls and tracked insertions', async () => {
  const source = await docx('<w:document><w:body><w:p><w:r><w:t>They </w:t></w:r><w:ins><w:r><w:t>could </w:t></w:r></w:ins><w:r><w:t>stay.</w:t></w:r></w:p><w:sdt><w:sdtContent><w:p><w:r><w:t>Visible content control.</w:t></w:r></w:p></w:sdtContent></w:sdt></w:body></w:document>');
  const result = await parseDocx(source, () => null);
  assert.deepEqual(result.rawParas.map(p => p.runs.map(r => r.text).join('')), ['They could stay.', 'Visible content control.']);
});

test('DOCX keeps an illustration inside a table between the surrounding text', async () => {
  const zip = new JSZip();
  const paragraph = value => `<w:p><w:r><w:t>${value}</w:t></w:r></w:p>`;
  const drawing = '<w:p><w:r><w:drawing><wp:inline><a:blip r:embed="rId1"/></wp:inline></w:drawing></w:r></w:p>';
  zip.file('word/document.xml', '<w:document><w:body><w:tbl><w:tr><w:tc>' + paragraph('Before') + drawing + paragraph('After') + '</w:tc></w:tr></w:tbl></w:body></w:document>');
  zip.file('word/_rels/document.xml.rels', '<Relationships><Relationship Id="rId1" Target="media/image.png"/></Relationships>');
  zip.file('word/media/image.png', 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', { base64: true });
  const result = await parseDocx(await zip.generateAsync({ type: 'nodebuffer' }), () => 'picture');
  assert.deepEqual(result.rawParas.map(p => p.image?.assetId || p.lines[0][0].text), ['Before', 'picture', 'After']);
});

'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const JSZip = require('jszip');
const { importSources } = require('../src/core/import');
const { buildBlocks } = require('../src/core/parse/blocks');

const para = (text, extra = {}) => ({ runs: [{ text }], ...extra });
async function importDoc(t, filename, paragraphs) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfmaker-test-'));
  t.after(async () => {
    assert.equal(path.dirname(dir), os.tmpdir());
    assert.ok(path.basename(dir).startsWith('pdfmaker-test-'));
    await fs.rm(dir, { recursive: true, force: true });
  });
  const doc = new JSZip();
  const escape = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  doc.file('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.map(p => `<w:p><w:pPr>${p.align ? `<w:jc w:val="${p.align}"/>` : ''}</w:pPr><w:r>${p.bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t>${escape(p.text)}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`);
  const zip = new JSZip();
  zip.file(`WORKING/${filename}`, await doc.generateAsync({ type: 'nodebuffer' }));
  const file = path.join(dir, 'WORKING.zip');
  await fs.writeFile(file, await zip.generateAsync({ type: 'nodebuffer' }));
  return (await importSources([file])).chapters[0];
}

test('DOCX in ZIP uses its internal chapter number and title with an opaque filename', async t => {
  const ch = await importDoc(t, 'Глава_0593.docx', [{ text: 'Глава 61. Выпускная поездка — Сеул' }, { text: 'Настоящий текст главы.' }]);
  assert.equal(ch.number, 61);
  assert.equal(ch.title, 'Выпускная поездка — Сеул');
  assert.equal(ch.blocks[0].runs[0].text, 'Настоящий текст главы.');
});
test('technical CH index cannot override an explicit heading inside DOCX', async t => {
  const ch = await importDoc(t, 'CH0002 — Глава 1. Начало.docx', [{ text: 'Глава 1. Начало' }, { text: 'Текст.' }]);
  assert.equal(ch.number, 1);
  assert.equal(ch.title, 'Начало');
  assert.ok(ch.issues.some(s => s.includes('номер') || s.includes('Номер')));
});
test('centered bold title on the next line becomes chapter metadata', async t => {
  const ch = await importDoc(t, 'CH0001.docx', [{ text: 'Глава 1', align: 'center', bold: true }, { text: 'Спутник I', align: 'center', bold: true }, { text: 'Бесконечная регрессия.' }]);
  assert.equal(ch.title, 'Спутник I');
  assert.equal(ch.blocks[0].runs[0].text, 'Бесконечная регрессия.');
});
test('a chapter without a title preserves its opening prose', async t => {
  const ch = await importDoc(t, 'CH0001.docx', [{ text: 'Глава 1' }, { text: 'Бесконечная регрессия.' }]);
  assert.equal(ch.title, '');
  assert.equal(ch.blocks[0].runs[0].text, 'Бесконечная регрессия.');
});
test('unnumbered prologue in the document sets section kind', async t => {
  const ch = await importDoc(t, 'export.docx', [{ text: 'Пролог — До рассвета' }, { text: 'Текст.' }]);
  assert.equal(ch.kind, 'prologue');
  assert.equal(ch.number, null);
  assert.equal(ch.title, 'До рассвета');
});
test('an opening number in ordinary prose is not a chapter heading', async t => {
  const ch = await importDoc(t, 'export.docx', [{ text: '1183-й цикл.' }, { text: 'Мир снова погиб.' }]);
  assert.equal(ch.number, null);
  assert.equal(ch.blocks[0].runs[0].text, '1183-й цикл.');
});
test('Unicode decorative rules become separators, but silent dialogue remains prose', () => {
  const { blocks } = buildBlocks(['──────────', '――――――――――', '* * *', '— …', '???'].map(s => para(s)), { kind: 'chapter', number: 1, title: '' });
  assert.deepEqual(blocks.map(b => b.type), ['sep', 'sep', 'sep', 'para', 'para']);
});
test('section words inside opening prose do not change chapter metadata', async t => {
  for (const text of ['Пролог этой истории начался задолго до рассвета.', 'Глава 2 уже осталась позади.']) {
    const ch = await importDoc(t, 'export.docx', [{ text }, { text: 'Продолжение.' }]);
    assert.equal(ch.kind, 'chapter');
    assert.equal(ch.number, null);
    assert.equal(ch.blocks[0].runs[0].text, text);
  }
});
test('centered opening prose after a chapter number remains prose', async t => {
  const ch = await importDoc(t, 'CH0001.docx', [{ text: 'Глава 1', align: 'center' }, { text: 'Мир снова погиб.', align: 'center' }, { text: 'Он открыл глаза.' }]);
  assert.equal(ch.title, '');
  assert.equal(ch.blocks[0].runs[0].text, 'Мир снова погиб.');
});
test('chapter label with a trailing period still recognizes a split title', async t => {
  const ch = await importDoc(t, 'export.docx', [{ text: 'Глава 1.' }, { text: 'Начало', bold: true, align: 'center' }, { text: 'Текст.' }]);
  assert.equal(ch.number, 1);
  assert.equal(ch.title, 'Начало');
});
test('ordinal chapter label in a WORKING export is recognized', async t => {
  const ch = await importDoc(t, 'Глава_0462.docx', [{ text: '48-я глава. Экзамены, месть и охотники на вампиров' }, { text: 'Текст.' }]);
  assert.equal(ch.number, 48);
  assert.equal(ch.title, 'Экзамены, месть и охотники на вампиров');
});
test('a bold centered split title preserves its question mark', async t => {
  const ch = await importDoc(t, 'CH0001.docx', [{ text: 'Глава 1', align: 'center', bold: true }, { text: 'Кто я?', align: 'center', bold: true }, { text: 'Он оглянулся.' }]);
  assert.equal(ch.title, 'Кто я?');
  assert.equal(ch.blocks[0].runs[0].text, 'Он оглянулся.');
});
test('ordinal chapter label without punctuation recognizes a split title', async t => {
  const ch = await importDoc(t, 'export.docx', [{ text: '48-я глава', align: 'center', bold: true }, { text: 'Начало', align: 'center', bold: true }, { text: 'Текст.' }]);
  assert.equal(ch.number, 48);
  assert.equal(ch.title, 'Начало');
  assert.equal(ch.blocks[0].runs[0].text, 'Текст.');
});

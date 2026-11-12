'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const JSZip = require('jszip');
const { parseHeading } = require('../src/core/parse/titles');
const { analyze } = require('../src/core/pipeline');

async function analyzeDocxArchive(t, documents) {
  const parent = await fs.realpath(os.tmpdir());
  const dir = await fs.mkdtemp(path.join(parent, 'pdfmaker-special-docx-'));
  t.after(async () => {
    const real = await fs.realpath(dir);
    assert.equal(path.dirname(real).toLowerCase(), parent.toLowerCase());
    assert.ok(path.basename(real).startsWith('pdfmaker-special-docx-'));
    await fs.rm(real, { recursive: true, force: true });
  });
  const archive = new JSZip();
  const escape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  for (const [filename, heading, subtitle] of documents) {
    const doc = new JSZip();
    const paragraphs = [{ text: heading }, ...(subtitle ? [{ text: subtitle, bold: true }] : []),
      { text: `Основной текст документа ${filename}.` }];
    doc.file('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.map(p => `<w:p><w:r>${p.bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t>${escape(p.text)}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`);
    archive.file(`WORKING/${filename}`, await doc.generateAsync({ type: 'nodebuffer' }));
  }
  const file = path.join(dir, 'WORKING.zip');
  await fs.writeFile(file, await archive.generateAsync({ type: 'nodebuffer' }));
  return analyze([file]);
}

test('explicit chapter numbers survive titles beginning with section names', () => {
  for (const [heading, number, title] of [
    ['Глава 505. Эпилог. Возвращение — 1', 505, 'Эпилог. Возвращение — 1'],
    ['Глава 556. Экстра. Новая дорога', 556, 'Экстра. Новая дорога'],
    ['Глава 1. Пролог. Начало', 1, 'Пролог. Начало'],
    ['Глава 50. Послесловие автора. Итоги', 50, 'Послесловие автора. Итоги'],
    ['Chapter 12 — Bonus. A new day', 12, 'Bonus. A new day'],
    ['48-я глава. Эпилог. Возвращение', 48, 'Эпилог. Возвращение'],
  ]) {
    assert.deepEqual(parseHeading(heading), { kind: 'chapter', number, title }, heading);
  }
});

test('unnumbered section headings and the dedicated illustration gallery keep their kinds', () => {
  for (const [heading, kind, title] of [
    ['Эпилог. Возвращение', 'epilogue', 'Возвращение'],
    ['Экстра. Новая дорога', 'extra', 'Новая дорога'],
    ['Пролог — Начало', 'prologue', 'Начало'],
    ['Послесловие автора. Итоги', 'afterword', 'Итоги'],
    ['Глава 0. Иллюстрации', 'illustrations', 'Иллюстрации'],
  ]) {
    assert.deepEqual(parseHeading(heading), { kind, number: null, title }, heading);
  }
});

test('numbered epilogues and extras remain in reading order without false audit gaps', async t => {
  const parent = await fs.realpath(os.tmpdir());
  const dir = await fs.mkdtemp(path.join(parent, 'pdfmaker-numbered-sections-'));
  t.after(async () => {
    assert.equal(path.dirname(await fs.realpath(dir)).toLowerCase(), parent.toLowerCase());
    await fs.rm(dir, { recursive: true, force: true });
  });
  for (const [number, title] of [
    [504, 'Возвращение'],
    [505, 'Эпилог. Новое утро'],
    [506, 'Экстра. Другая дорога'],
    [507, 'Продолжение'],
  ]) {
    await fs.writeFile(path.join(dir, `Глава ${number}.txt`), `Глава ${number}. ${title}\n\nТекст раздела номер ${number}.`);
  }
  const result = await analyze([dir]);
  assert.deepEqual(result.summary.chapters.map(ch => ch.number), [504, 505, 506, 507]);
  assert.deepEqual(result.audit.gaps, []);
  assert.equal(result.audit.included, 4);
  assert.equal(result.audit.chapters, 4);
  assert.deepEqual(result.sourceWarnings, []);
  assert.equal(result.summary.chapters[1].label, '505. Эпилог. Новое утро');
});

test('unnumbered special DOCX headings preserve chapter numbers from both filename formats', async t => {
  for (const [filename, heading, number] of [
    ['Глава_0301.docx', 'Пролог — Начало', 301],
    ['Глава_0302.docx', 'Эпилог. Возвращение', 302],
    ['Глава_0303.docx', 'Послесловие автора', 303],
    ['Глава_0304.docx', 'Экстра. Другая дорога', 304],
    ['Глава 305. Пролог. Начало.docx', 'Пролог. Начало', 305],
    ['Глава 306. Эпилог. Возвращение.docx', 'Эпилог. Возвращение', 306],
    ['Глава 307. Послесловие автора.docx', 'Послесловие автора', 307],
    ['Глава 308. Экстра. Другая дорога.docx', 'Экстра. Другая дорога', 308],
    ['Глава_0309.docx', 'Эпилог.', 309],
    ['Глава_0310.docx', 'Послесловие автора:', 310],
    ['Глава_0311.docx', 'Экстра —', 311],
  ]) {
    await t.test(filename, async t => {
      const result = await analyzeDocxArchive(t, [[filename, heading]]);
      const chapter = result.summary.chapters[0];
      assert.equal(chapter.kind, 'chapter');
      assert.equal(chapter.number, number);
      assert.equal(chapter.title, heading);
      assert.equal(chapter.label, `${number}. ${heading}`);
      assert.equal(chapter.blocks, 1);
      assert.equal(chapter.include, true);
    });
  }
});

test('numbered DOCX afterwords and same-titled epilogues stay ordered and included without false gaps', async t => {
  const result = await analyzeDocxArchive(t, [
    ['Глава_0306.docx', 'Эпилог. Возвращение'],
    ['Глава 303. Последний день.docx', 'Глава 303. Последний день'],
    ['Глава 305. Эпилог. Возвращение.docx', 'Эпилог. Возвращение'],
    ['Глава_0304.docx', 'Послесловие автора'],
    ['Глава 307. Новое начало.docx', 'Глава 307. Новое начало'],
  ]);
  assert.deepEqual(result.summary.chapters.map(ch => ch.number), [303, 304, 305, 306, 307]);
  assert.ok(result.summary.chapters.every(ch => ch.kind === 'chapter' && ch.include));
  assert.deepEqual(result.audit.duplicates, []);
  assert.deepEqual(result.audit.gaps, []);
  assert.equal(result.audit.included, 5);
  assert.equal(result.audit.chapters, 5);
  assert.deepEqual(result.sourceWarnings, []);
  assert.equal(result.summary.chapters[1].label, '304. Послесловие автора');
});

test('a numbered DOCX special heading retains a separately formatted subtitle', async t => {
  for (const heading of ['Эпилог', 'Эпилог.', 'Эпилог:', 'Эпилог —']) {
    await t.test(heading, async t => {
      const result = await analyzeDocxArchive(t, [['Глава_0313.docx', heading, 'После бури']]);
      const chapter = result.summary.chapters[0];
      assert.equal(chapter.kind, 'chapter');
      assert.equal(chapter.number, 313);
      assert.equal(chapter.title, 'Эпилог. После бури');
      assert.equal(chapter.blocks, 1);
    });
  }
});

test('a genuinely absent chapter still produces a gap warning between numbered special DOCX sections', async t => {
  const result = await analyzeDocxArchive(t, [
    ['Глава_0303.docx', 'Глава 303. Последний день'],
    ['Глава_0304.docx', 'Послесловие автора'],
    ['Глава 306. Эпилог. Возвращение.docx', 'Эпилог. Возвращение'],
    ['Глава_0307.docx', 'Глава 307. Новое начало'],
  ]);
  assert.deepEqual(result.audit.gaps, [305]);
  assert.equal(result.sourceWarnings.length, 1);
  assert.match(result.sourceWarnings[0], /отсутствуют главы: 305\./);
});

test('an explicit DOCX chapter number still overrides a technical filename number', async t => {
  const result = await analyzeDocxArchive(t, [
    ['Глава_0593.docx', 'Глава 61. Эпилог. Возвращение'],
  ]);
  const chapter = result.summary.chapters[0];
  assert.equal(chapter.kind, 'chapter');
  assert.equal(chapter.number, 61);
  assert.equal(chapter.title, 'Эпилог. Возвращение');
  assert.ok(chapter.issues.some(issue => /593.*61.*выбран номер из документа/.test(issue)));
});

test('genuinely unnumbered DOCX epilogues and numbered illustration galleries keep their kinds', async t => {
  for (const [filename, heading, kind, title] of [
    ['export.docx', 'Эпилог. Возвращение', 'epilogue', 'Возвращение'],
    ['Глава_0000.docx', 'Глава 0. Иллюстрации', 'illustrations', 'Иллюстрации'],
    ['Глава 0. Иллюстрации.docx', 'Глава 0. Иллюстрации', 'illustrations', 'Иллюстрации'],
  ]) {
    const result = await analyzeDocxArchive(t, [[filename, heading]]);
    const chapter = result.summary.chapters[0];
    assert.equal(chapter.kind, kind);
    assert.equal(chapter.number, null);
    assert.equal(chapter.title, title);
  }
});

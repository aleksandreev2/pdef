'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { parseDocument, DomUtils } = require('htmlparser2');
const JSZip = require('jszip');
const { buildEpub } = require('../src/core/epub/build');
const { checkEpub } = require('../src/core/qa/epub');
const { makeBook, makeChapter } = require('../src/core/model');
const { clampStyle } = require('../src/core/style');

for (const signature of [false, true]) {
  test(`EPUB keeps the chapter number inside its heading (signature: ${signature})`, async (t) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfmaker-epub-headings-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const book = makeBook();
    book.title = 'Проверка заголовков';
    book.chapters = [
      { id: 'named', number: 5, title: 'Всё становится сложнее' },
      { id: 'untitled', number: 6 },
      { id: 'unnumbered', title: 'Отдельная история' },
    ].map((chapter) => makeChapter({
      ...chapter,
      blocks: [{ type: 'para', runs: [{ text: 'Текст главы.' }] }],
    }));

    const outPath = path.join(dir, 'book.epub');
    await buildEpub({ book, style: clampStyle({ signature }), outPath });
    const zip = await JSZip.loadAsync(await fs.readFile(outPath));
    const options = { book, expected: { sections: 3 } };
    const qa = await checkEpub(outPath, options);
    assert.equal(qa.ok, true, JSON.stringify(qa.checks.filter(check => !check.ok)));
    const normalizedText = (node) => DomUtils.textContent(node).replace(/\s+/g, ' ').trim();
    for (const [file, headingText] of [
      ['ch001.xhtml', 'ГЛАВА 5 Всё становится сложнее'],
      ['ch002.xhtml', 'ГЛАВА 6'],
      ['ch003.xhtml', 'Отдельная история'],
    ]) {
      const xhtml = await zip.file(`EPUB/text/${file}`).async('string');
      const dom = parseDocument(xhtml, { xmlMode: true });
      const headings = DomUtils.getElementsByTagName('h1', dom.children);
      assert.deepEqual(headings.map(normalizedText), [headingText], file);
      const [section] = DomUtils.getElementsByTagName('section', dom.children);
      assert.equal(normalizedText(section), `${headingText} Текст главы.`, file);
    }
    const source = await zip.file('EPUB/text/ch001.xhtml').async('string');
    for (const damaged of [
      source.replace(/<span class="kicker">[^<]*<\/span>/, ''),
      source.replace(/<span class="chapter-name">[^<]*<\/span>/, ''),
      source.replace(/<p class="noindent">[^<]*<\/p>/, ''),
    ]) {
      assert.notEqual(damaged, source);
      zip.file('EPUB/text/ch001.xhtml', damaged);
      await fs.writeFile(outPath, await zip.generateAsync({ type: 'nodebuffer' }));
      const result = await checkEpub(outPath, options);
      assert.equal(result.checks.find(check => check.name === 'Текст всех глав сохранён в исходном порядке').ok, false);
    }
  });
}

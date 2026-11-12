'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { fileURLToPath } = require('node:url');
const test = require('node:test');

test('book process retains edits across calls and supplies usable PDF file URLs', async t => {
  const { createBookService, withPreviewUrls } = require('../src/main/book-service');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfmaker-worker-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const input = path.join(dir, 'Глава 1.txt');
  await fs.writeFile(input, 'Глава 1. Проверка\n\nЗа окном светало.');
  const entry = require.resolve('../src/main/book-worker');
  const thread = new Worker(`require(${JSON.stringify(entry)}).serveBook(require('node:worker_threads').parentPort)`, { eval: true });
  t.after(() => thread.terminate());
  const book = createBookService(() => thread);
  const progress = [];
  const analyzed = await book.request('analyze', [input], update => progress.push(update.phase));
  assert.ok(progress.includes('import'));
  const [{ id }] = analyzed.summary.chapters;
  const edited = await book.request('applyEdits', { chapters: [{ id, title: 'Новое название' }] });
  assert.equal(edited.summary.chapters[0].title, 'Новое название');
  const report = withPreviewUrls(await book.request('build', {
    meta: { title: 'Проверка #1 100%' }, outDir: dir, formats: { epub: false },
  }));
  assert.equal(fileURLToPath(report.pdf.fileUrl), report.pdf.path);
  assert.ok(report.pdf.fileUrl.includes('%231_100%25'));
  assert.ok(report.pdf.size > 100);
  assert.ok((await fs.stat(report.pdf.path)).isFile());
});

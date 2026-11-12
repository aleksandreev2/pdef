'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

test('a later version wins when an older PDF finishes loading last', async () => {
  const { createPdfPreviewSession } = await import('../src/renderer/pdf-preview-session.mjs');
  const loads = new Map();
  const destroyed = [];
  const session = createPdfPreviewSession(url => ({
    promise: new Promise(resolve => loads.set(url, () => resolve(url))),
    destroy: async () => { destroyed.push(url); },
  }));
  const oldVersion = session.render('old.pdf', async doc => doc);
  const currentVersion = session.render('current.pdf', async doc => doc);
  loads.get('current.pdf')();
  assert.equal(await currentVersion, 'current.pdf');
  loads.get('old.pdf')();
  assert.equal(await oldVersion, null);
  assert.deepEqual(destroyed, ['old.pdf']);
});

test('switching widths cancels the obsolete draw and reuses the open document', async () => {
  const { createPdfPreviewSession } = await import('../src/renderer/pdf-preview-session.mjs');
  let loads = 0;
  const doc = {};
  const session = createPdfPreviewSession(() => {
    loads++;
    return { promise: Promise.resolve(doc), destroy: async () => {} };
  });
  let began;
  const drawing = new Promise(resolve => { began = resolve; });
  const oldWidth = session.render('book.pdf', async (_doc, request) => {
    let rejectDraw;
    const promise = new Promise((_resolve, reject) => { rejectDraw = reject; });
    const complete = request.draw({ promise, cancel: () => rejectDraw(new Error('cancelled')) });
    began();
    await complete;
    return 'old width';
  });
  await drawing;
  const newWidth = session.render('book.pdf', async current => {
    assert.equal(current, doc);
    return 'new width';
  });
  assert.equal(await oldWidth, null);
  assert.equal(await newWidth, 'new width');
  assert.equal(loads, 1);
});

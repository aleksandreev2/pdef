'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const JSZip = require('jszip');
const { buildEpub } = require('../src/core/epub/build');
const { makeBook, makeChapter } = require('../src/core/model');
const { clampStyle } = require('../src/core/style');

function localEntries(archive) {
  const entries = new Map();
  for (let offset = 0; archive.readUInt32LE(offset) === 0x04034b50;) {
    const nameLength = archive.readUInt16LE(offset + 26);
    const name = archive.toString('utf8', offset + 30, offset + 30 + nameLength);
    entries.set(name, archive.readUInt16LE(offset + 8));
    offset += 30 + nameLength + archive.readUInt16LE(offset + 28) + archive.readUInt32LE(offset + 18);
  }
  return entries;
}

test('EPUB stores precompressed media unchanged and still deflates XHTML', async t => {
  const parent = await fs.realpath(os.tmpdir());
  const dir = await fs.mkdtemp(path.join(parent, 'pdef-epub-packaging-'));
  t.after(async () => {
    assert.equal(path.dirname(await fs.realpath(dir)).toLowerCase(), parent.toLowerCase());
    await fs.rm(dir, { recursive: true, force: true });
  });
  const outPath = path.join(dir, 'book.epub');
  const data = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
  const book = makeBook();
  book.title = 'Проверка упаковки';
  book.assets.set('img001', { id: 'img001', ext: 'png', mime: 'image/png', data });
  book.chapters = [makeChapter({ id: 'a', number: 1, title: 'Глава', blocks: [{ type: 'image', assetId: 'img001' }] })];
  const result = await buildEpub({ book, style: clampStyle({}), outPath });
  const bytes = await fs.readFile(outPath);
  const methods = localEntries(bytes);
  assert.equal(methods.keys().next().value, 'mimetype');
  assert.equal(methods.get('mimetype'), 0);
  assert.equal(methods.get('EPUB/images/img001.png'), 0);
  assert.equal(methods.get('EPUB/images/pdef-ornament-opener.png'), 0);
  assert.equal(methods.get('EPUB/text/ch001.xhtml'), 8);
  assert.equal(result.size, bytes.length);
  assert.deepEqual(await (await JSZip.loadAsync(bytes, { checkCRC32: true })).file('EPUB/images/img001.png').async('nodebuffer'), data);
  assert.deepEqual(await fs.readdir(dir), ['book.epub']);
});

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { addCoverFile, analyze, applyEdits, assetThumbnail, clearBook, getSession } = require('../src/core/pipeline');

test('adding a cover preserves current edits and makes a bounded preview without changing the original', async t => {
  const parent = await fs.realpath(os.tmpdir());
  const dir = await fs.mkdtemp(path.join(parent, 'pdef-cover-preview-'));
  t.after(async () => {
    assert.equal(path.dirname(await fs.realpath(dir)).toLowerCase(), parent.toLowerCase());
    await fs.rm(dir, { recursive: true, force: true });
  });
  const chapterPath = path.join(dir, 'Глава 1.txt');
  const coverPath = path.join(dir, 'Обложка.png');
  await fs.writeFile(chapterPath, 'Глава 1. Исходная\n\nТекст главы.');
  const canvas = createCanvas(1000, 2000);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1b4252';
  ctx.fillRect(0, 0, 750, 1800);
  const cover = await canvas.encode('png');
  await fs.writeFile(coverPath, cover);
  const analysis = await analyze([chapterPath]);
  const id = analysis.summary.chapters[0].id;
  applyEdits({ chapters: [{ id, title: 'Правка' }] });
  await fs.writeFile(chapterPath, 'Новые данные на диске');
  const candidate = await addCoverFile(coverPath);
  assert.deepEqual(candidate.paths, [coverPath]);
  assert.equal((await addCoverFile(coverPath)).assetId, candidate.assetId);
  const updated = applyEdits({ cover: candidate.assetId, compact: true });
  assert.equal(updated.summary.chapters[0].title, 'Правка');
  assert.equal(updated.summary.assets, undefined);
  assert.deepEqual(getSession().book.assets.get(candidate.assetId).data, cover);
  const thumbnail = await assetThumbnail(candidate.assetId);
  const image = await loadImage(Buffer.from(thumbnail.split(',')[1], 'base64'));
  assert.ok(image.height <= 256 && image.height < 2000);
  assert.equal(image.height, image.width * 2);
  assert.equal(await assetThumbnail(candidate.assetId), thumbnail);

  clearBook();
  assert.equal(await assetThumbnail(candidate.assetId), null);
  const first = await addCoverFile(coverPath);
  assert.deepEqual(applyEdits({ cover: first.assetId }).summary.chapters, []);
});

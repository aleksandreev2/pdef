'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const {findConverter} = require('../src/core/export/kindle');

test('installed app finds its bundled converter on a PC without Calibre or PATH tools', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfmaker-discovery-'));
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const options = {platform: 'win32', env: {PATH: ''}, home: path.join(dir, 'new-user'),
    root: path.join(dir, 'app.asar'), resourcesPath: path.join(dir, 'resources')};
  assert.equal(await findConverter(options), null);
  const bundled = path.join(options.resourcesPath, 'calibre', 'ebook-convert.exe');
  await fs.mkdir(path.dirname(bundled), {recursive: true});
  await fs.writeFile(bundled, 'bundled converter');
  const legacy = path.join(options.home, '.pdfmaker', 'Calibre Portable', 'Calibre', 'ebook-convert.exe');
  await fs.mkdir(path.dirname(legacy), {recursive: true});
  await fs.writeFile(legacy, 'older converter');
  assert.equal(await findConverter(options), bundled);
  options.env.PDFMAKER_CALIBRE = path.join(dir, 'missing.exe');
  assert.equal(await findConverter(options), bundled, 'a stale override does not break the bundled converter');
  options.env.PDFMAKER_CALIBRE = legacy;
  assert.equal(await findConverter(options), legacy, 'an explicit valid override is still respected');
});

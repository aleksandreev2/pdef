'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createOutputPreferences } = require('../src/main/output-preferences');

const defaults = { pdf: true, epub: true, fb2: false, mobi: false, azw3: false, txt: false };

async function fixture(t) {
  const parent = await fs.realpath(os.tmpdir());
  const dir = await fs.mkdtemp(path.join(parent, 'pdef-format-preferences-'));
  t.after(async () => {
    assert.equal(path.dirname(await fs.realpath(dir)).toLowerCase(), parent.toLowerCase());
    await fs.rm(dir, { recursive: true, force: true });
  });
  return { dir, file: path.join(dir, 'preferences.json') };
}

test('output formats survive restart, including an explicitly empty selection', async t => {
  const { file } = await fixture(t);
  const prefs = createOutputPreferences(file);
  assert.deepEqual(await prefs.getFormats?.(), defaults);
  const selected = { pdf: false, epub: false, fb2: true, mobi: false, azw3: true, txt: true };
  await prefs.setFormats(selected);
  assert.deepEqual(await createOutputPreferences(file).getFormats(), selected);
  const empty = { pdf: false, epub: false, fb2: false, mobi: false, azw3: false, txt: false };
  await prefs.setFormats(empty);
  assert.deepEqual(await createOutputPreferences(file).getFormats(), empty);
});

test('old or damaged preferences restore default formats and ignore invalid fields', async t => {
  const { dir, file } = await fixture(t);
  const prefs = createOutputPreferences(file);
  for (const data of ['{broken', 'null', '[]', JSON.stringify({ outDir: dir }), JSON.stringify({ formats: null })]) {
    await fs.writeFile(file, data);
    assert.deepEqual(await prefs.getFormats?.(), defaults);
  }
  await fs.writeFile(file, JSON.stringify({ formats: { pdf: 'false', epub: false, fb2: true, mobi: 1, unknown: true } }));
  assert.deepEqual(await prefs.getFormats(), { pdf: true, epub: false, fb2: true, mobi: false, azw3: false, txt: false });
});

test('rapid format edits preserve the last selection, folder and book metadata', async t => {
  const { dir, file } = await fixture(t);
  const prefs = createOutputPreferences(file);
  assert.deepEqual(await prefs.getFormats?.(), defaults);
  const selected = { pdf: false, epub: false, fb2: false, mobi: true, azw3: false, txt: false };
  const writes = [
    prefs.setFormats(defaults),
    prefs.set(dir),
    prefs.setFormats({ ...selected, pdf: true }),
    prefs.setMetadata({ team: 'Saved team' }),
    prefs.setFormats({ ...selected, unknown: true }),
  ];
  await prefs.pendingWrite();
  await Promise.all(writes);
  const restarted = createOutputPreferences(file);
  assert.deepEqual(await restarted.getFormats(), selected);
  assert.equal(await restarted.get(), dir);
  assert.deepEqual(await restarted.getMetadata(), { team: 'Saved team' });
});

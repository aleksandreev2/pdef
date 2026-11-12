'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');

async function fixture(t){
  const parent=await fs.realpath(os.tmpdir()),dir=await fs.mkdtemp(path.join(parent,'pdfmaker-preferences-test-'));
  t.after(async()=>{
    assert.equal(path.dirname(await fs.realpath(dir)).toLowerCase(),parent.toLowerCase());
    await fs.rm(dir,{recursive:true,force:true});
  });
  return {dir,file:path.join(dir,'profile','preferences.json')};
}

test('the output directory persists across fresh preference instances and can be changed',async t=>{
  const {createOutputPreferences}=require('../src/main/output-preferences');
  const {dir,file}=await fixture(t),chosen=path.join(dir,'Мои книги');
  const first=createOutputPreferences(file);
  assert.equal(await first.get(),null);
  await first.set(chosen);
  assert.equal(await createOutputPreferences(file).get(),chosen);
  const changed=path.join(dir,'Другие книги');
  await createOutputPreferences(file).set(changed);
  assert.equal(await first.get(),changed);
  await assert.rejects(first.set('../relative'),/папк/i);
  assert.equal(await first.get(),changed);
});

test('damaged preferences do not prevent choosing and remembering a new output directory',async t=>{
  const {createOutputPreferences}=require('../src/main/output-preferences');
  const {dir,file}=await fixture(t);
  await fs.mkdir(path.dirname(file));await fs.writeFile(file,'{broken');
  const prefs=createOutputPreferences(file);assert.equal(await prefs.get(),null);
  await prefs.set(dir);assert.equal(await createOutputPreferences(file).get(),dir);
  for(const value of [null,[],{outDir:'relative'},{outDir:42}]){
    await fs.writeFile(file,JSON.stringify(value));assert.equal(await prefs.get(),null);
  }
});

test('book metadata is restored across sessions and rapid edits preserve the export folder', async t => {
  const {createOutputPreferences} = require('../src/main/output-preferences');
  const {dir, file} = await fixture(t);
  await fs.mkdir(path.dirname(file));
  await fs.writeFile(file, JSON.stringify({outDir: dir}));
  const prefs = createOutputPreferences(file);
  assert.deepEqual(await prefs.getMetadata(), {});
  const nextDir = path.join(dir, 'Книги');
  const edits = [
    prefs.setMetadata({subtitle: 'Полное собрание'}),
    prefs.setMetadata({team: 'Команда перевода'}),
    prefs.set(nextDir),
    prefs.setMetadata({teamUrl: 'https://example.test/team', title: 'Другая книга'}),
    prefs.setMetadata({subtitle: ''}),
  ];
  await prefs.pendingWrite();
  await Promise.all(edits);
  const restarted = createOutputPreferences(file);
  assert.equal(await restarted.get(), nextDir);
  assert.deepEqual(await restarted.getMetadata(), {
    subtitle: '', team: 'Команда перевода', teamUrl: 'https://example.test/team',
  });
});

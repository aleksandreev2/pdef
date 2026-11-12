'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {analyze,applyEdits,build}=require('../src/core/pipeline');

async function fixture(t,files) {
  const parent=await fs.realpath(os.tmpdir());
  const dir=await fs.mkdtemp(path.join(parent,'pdfmaker-audit-test-'));
  t.after(async()=>{
    assert.equal(path.dirname(await fs.realpath(dir)).toLowerCase(),parent.toLowerCase());
    await fs.rm(dir,{recursive:true,force:true});
  });
  for(const [name,data] of Object.entries(files)) await fs.writeFile(path.join(dir,name),data);
  return dir;
}

test('analysis exposes missing chapter numbers and empty filenames as warnings',async t=>{
  const dir=await fixture(t,{'050.txt':'Глава 50. Начало\n\nТекст первой главы.','052.txt':'Глава 52. Дорога\n\nТекст следующей главы.','053.txt':' \n\t','054.docx':''});
  const result=await analyze([dir]);
  assert.deepEqual(result.audit.gaps,[51]);
  assert.deepEqual(result.audit.empty.map(e=>e.file),['053.txt','054.docx']);
  assert.equal(result.audit.broken.length,0);
  assert.ok(result.sourceWarnings.some(w=>/051/.test(w)));
  assert.ok(result.sourceWarnings.some(w=>/053\.txt/.test(w)));
  assert.ok(result.sourceWarnings.some(w=>/054\.docx/.test(w)));
  assert.ok(!result.sourceWarnings.some(w=>/001/.test(w)));
  assert.equal(result.summary.chapters.filter(c=>c.include).length,2);
});

test('corrupt documents have a distinct warning and are not reported as empty',async t=>{
  const dir=await fixture(t,{'001.docx':'это не DOCX','002.txt':'Глава 2\n\nТекст.'});
  const result=await analyze([dir]);
  assert.equal(result.audit.broken.length,1);
  assert.equal(result.audit.empty.length,0);
  assert.ok(result.sourceWarnings.some(w=>/001\.docx/.test(w)&&/не разобран/i.test(w)));
});

test('warnings follow current chapter selection and survive export in the report',async t=>{
  const dir=await fixture(t,{'001.txt':'Глава 1\n\nПервый текст.','002.txt':'Глава 2\n\nВторой текст.','003.txt':'Глава 3\n\nТретий текст.','004.txt':'Глава 4'});
  const result=await analyze([dir]);
  const two=result.summary.chapters.find(c=>c.number===2);
  const empty=result.summary.chapters.find(c=>c.number===4);
  let edits=applyEdits({chapters:[{id:two.id,include:false},{id:empty.id,include:true}]});
  assert.deepEqual(edits.audit.gaps,[2]);
  assert.equal(edits.audit.included,2);
  assert.equal(edits.summary.chapters.find(c=>c.id===empty.id).include,false);
  assert.ok(edits.sourceWarnings.some(w=>/002/.test(w)));
  const report=await build({meta:{title:'Проверка'},outDir:path.join(dir,'out'),formats:{pdf:false,epub:false,txt:true}});
  assert.ok(report.sourceWarnings.some(w=>/002/.test(w)));
  assert.ok(report.sourceWarnings.some(w=>/004\.txt/.test(w)));
  edits=applyEdits({chapters:[{id:two.id,include:true}]});
  assert.deepEqual(edits.audit.gaps,[]);
  assert.equal(edits.sourceWarnings.length,1);
  assert.equal(edits.audit.included,3);
});

test('consecutive chapters in a later volume produce no missing-start warning',async t=>{
  const dir=await fixture(t,{'050.txt':'Глава 50\n\nТекст первой.','051.txt':'Глава 51\n\nТекст второй.'});
  const result=await analyze([dir]);
  assert.deepEqual(result.sourceWarnings,[]);
});

test('competing versions start selected and the author can choose which to export', async t => {
  const dir = await fixture(t, {
    'вариант A.txt': 'Глава 7. Путь\n\nТекст первой версии.',
    'вариант B.txt': 'Глава 7. Начало\n\nТекст другой версии.',
  });
  const result = await analyze([dir]);
  const [first, second] = result.summary.chapters;
  assert.equal(result.audit.duplicates.length, 1);
  assert.ok(first.include && second.include);
  assert.ok(result.sourceWarnings.some(w => /одним номером/.test(w)));
  const edited = applyEdits({ chapters: [{ id: first.id, include: false }] });
  assert.deepEqual(edited.summary.chapters.filter(c => c.include).map(c => c.id), [second.id]);
  assert.deepEqual(edited.sourceWarnings, []);
  const report = await build({ meta: {}, outDir: path.join(dir, 'out'), formats: { pdf: false, epub: false, txt: true } });
  const text = await fs.readFile(report.txt.path, 'utf8');
  assert.match(text, /другой версии/);
  assert.doesNotMatch(text, /первой версии/);
  const restored = applyEdits({ chapters: [{ id: first.id, include: true }] });
  assert.equal(restored.audit.included, 2);
});

test('edited chapter titles and numbers update the audit, order and exported headings', async t => {
  const dir = await fixture(t, {
    'A.txt': 'Глава 1. Начало\n\nТекст первой главы.',
    'B.txt': 'Глава 1. Черновик\n\nТекст второй главы.',
  });
  const loaded = await analyze([dir]);
  const [first, second] = loaded.summary.chapters;
  let edited = applyEdits({ chapters: [{ id: second.id, title: ' Дорога ', number: 0 }] });
  assert.deepEqual(edited.summary.chapters.map(ch => [ch.id, ch.number, ch.title]), [
    [second.id, 0, 'Дорога'], [first.id, 1, 'Начало'],
  ]);
  assert.deepEqual(edited.audit.duplicates, []);
  assert.ok(edited.summary.chapters.every(ch => ch.issues.every(issue => !/версия|дубль/.test(issue))));
  edited = applyEdits({ chapters: [{ id: second.id, number: -1 }, { id: first.id, number: 1.5 }] });
  assert.deepEqual(edited.summary.chapters.map(ch => ch.number), [0, 1]);
  const report = await build({ meta: {}, outDir: path.join(dir, 'out'), formats: { pdf: false, epub: false, txt: true } });
  const text = await fs.readFile(report.txt.path, 'utf8');
  assert.match(text, /000\. Дорога[\s\S]*001\. Начало/);
  edited = applyEdits({ chapters: [{ id: second.id, number: null }] });
  assert.equal(edited.summary.chapters.find(ch => ch.id === second.id).number, null);
});

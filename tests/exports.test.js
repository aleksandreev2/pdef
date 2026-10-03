'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {analyze,applyEdits,build}=require('../src/core/pipeline');
const {importSources}=require('../src/core/import');
const {blockText}=require('../src/core/model');
const {XMLValidator}=require('fast-xml-parser');
const JSZip=require('jszip');
async function fixture(t){
  const parent=await fs.realpath(os.tmpdir()),dir=await fs.mkdtemp(path.join(parent,'pdfmaker-export-test-'));
  t.after(async()=>{assert.equal(path.dirname(await fs.realpath(dir)).toLowerCase(),parent.toLowerCase());await fs.rm(dir,{recursive:true,force:true});});
  const zip=new JSZip();
  zip.file('001.txt','Глава 1. Рассвет\n\nЗа окном светало.\n\n* * *\n\n[Сила: 10]\n[Ловкость: 20]');
  zip.file('002.txt','Глава 2. Дорога\n\nОн отправился в путь.');
  zip.file('003.txt','Глава 3. Исключённая\n\nЭтот текст не должен попасть в книгу.');
  const input=path.join(dir,'chapters.zip');await fs.writeFile(input,await zip.generateAsync({type:'nodebuffer'}));
  const a=await analyze([input]);
  applyEdits({chapters:[{id:a.summary.chapters[2].id,include:false}],order:[a.summary.chapters[1].id,a.summary.chapters[0].id,a.summary.chapters[2].id]});
  return dir;
}
for(const format of ['txt','fb2']) test(`${format.toUpperCase()} exports only selected chapters in the chosen order`,async t=>{
  const dir=await fixture(t);
  const report=await build({meta:{title:'Новая книга & путь'},style:{genre:'fantasy'},outDir:dir,formats:{pdf:false,epub:false,[format]:true}});
  assert.ok(report[format]?.path); assert.equal(report.pdf,null);assert.equal(report.epub,null);
  const text=await fs.readFile(report[format].path,'utf8');
  assert.ok(text.indexOf('Дорога')<text.indexOf('Рассвет'));assert.ok(!text.includes('Этот текст не должен'));
  assert.ok(text.includes('За окном светало.'));assert.ok(text.includes('Ловкость: 20'));
  assert.equal(report[format].chapters,2);assert.equal(report.qa[format].ok,true);
  if(format==='fb2'){
    assert.equal(XMLValidator.validate(text),true);
    assert.ok(text.includes('Новая книга &amp; путь'));assert.ok(text.includes('content-type="image/png"'));
    const imported=await importSources([report.fb2.path]);
    assert.equal(imported.title,'Новая книга & путь');assert.equal(imported.chapters.length,2);
    assert.ok(imported.chapters.flatMap(c=>c.blocks).some(b=>b.type==='image'));
  } else assert.ok(text.includes('* * *'));
});
test('FB2 preserves cover, inline formatting, lists, links and image resources',async t=>{
  const dir=await fixture(t),p=path.join(dir,'book.fb2');
  const pixel='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
  await fs.writeFile(p,`<FictionBook xmlns:l="http://www.w3.org/1999/xlink"><description><title-info><book-title>Название</book-title><author><first-name>Тестовый</first-name><last-name>Автор</last-name></author><lang>ru</lang><coverpage><image l:href="#c"/></coverpage></title-info></description><body><section><title><p>Глава 1. Начало</p></title><p>Это <strong>жирный</strong> и <emphasis>курсивный</emphasis> текст с <a l:href="https://example.test/page?a=1&amp;b=2">ссылкой</a>.</p><image l:href="#c"/></section></body><binary id="c" content-type="image/png">${pixel}</binary></FictionBook>`);
  await analyze([p]);
  const report=await build({meta:{},outDir:dir,formats:{pdf:false,epub:false,fb2:true}});
  const text=await fs.readFile(report.fb2.path,'utf8');assert.equal(XMLValidator.validate(text),true);
  assert.ok(text.includes('<strong>жирный</strong>'));assert.ok(text.includes('<emphasis>курсивный</emphasis>'));assert.ok(text.includes('<coverpage>'));
  const imported=await importSources([report.fb2.path]);assert.equal(imported.author,'Тестовый Автор');assert.equal(imported.language,'ru');
  assert.ok(imported.loose.length);assert.ok(imported.chapters[0].blocks.map(blockText).join(' ').includes('курсивный текст'));
});
test('export with no selected formats fails before creating files',async t=>{
  const dir=await fixture(t);
  await assert.rejects(build({meta:{},outDir:path.join(dir,'no-output'),formats:{pdf:false,epub:false,fb2:false,mobi:false,azw3:false,txt:false}}),/Выберите.*формат/i);
  await assert.rejects(fs.access(path.join(dir,'no-output')));
});
test('Kindle export produces real MOBI and KF8 files, including when EPUB is unchecked',async t=>{
  const {findConverter}=require('../src/core/export/kindle');
  if(!await findConverter()) {t.skip('Calibre is not installed');return;}
  const dir=await fixture(t);
  const report=await build({meta:{title:'Книга для Kindle'},style:{genre:'fantasy'},outDir:dir,formats:{pdf:false,epub:false,mobi:true,azw3:true}});
  assert.equal(report.epub,null);
  for(const format of ['mobi','azw3']) {
    const data=await fs.readFile(report[format].path);
    assert.equal(data.toString('ascii',60,68),'BOOKMOBI');
    assert.equal(data.readUInt32BE(data.readUInt32BE(78)+36),format==='azw3'?8:6,'Actual MOBI/KF8 header version');
    assert.equal(report[format].chapters,2);assert.equal(report.qa[format].ok,true);
    const imported=await importSources([report[format].path]);
    const text=imported.chapters.flatMap(c=>c.blocks.map(blockText)).join(' ');
    assert.ok(text.includes('За окном светало.'));assert.ok(text.includes('Он отправился в путь.'));assert.ok(!text.includes('Этот текст не должен'));
  }
  assert.ok(!(await fs.readdir(dir)).some(n=>n.endsWith('.epub')));
});
test('FB2 image-only galleries and underlined links conform to its official schema',async t=>{
  const {buildFb2}=require('../src/core/export/fb2'),{validateFb2}=require('../src/core/qa/fb2-schema'),{makeBook,makeChapter}=require('../src/core/model'),{clampStyle}=require('../src/core/style');
  const dir=await fixture(t),book=makeBook();book.title='Галерея';
  book.assets.set('pic',{data:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64'),mime:'image/png'});
  book.chapters=[makeChapter({id:'gallery',title:'Иллюстрации',blocks:[{type:'image',assetId:'pic'},{type:'sep'},{type:'image',assetId:'pic'}]}),makeChapter({id:'link',title:'Ссылка',blocks:[{type:'para',runs:[{text:'Подчёркнутая ссылка',u:true,b:true,link:'https://example.test/'}]}]})];
  for(const signature of [false,true]){
    const file=path.join(dir,'gallery.fb2');await buildFb2({book,style:clampStyle({signature}),outPath:file});
    const result=await validateFb2(await fs.readFile(file,'utf8'));
    assert.equal(result.valid,true,result.errors.map(e=>e.message).join('\n'));
  }
});
test('failed Kindle conversion keeps a previous output and removes its temporary files',async t=>{
  const {findConverter,buildKindle}=require('../src/core/export/kindle');
  if(!await findConverter()) {t.skip('Calibre is not installed');return;}
  const dir=await fixture(t),input=path.join(dir,'broken.epub'),output=path.join(dir,'previous.mobi');
  await fs.writeFile(input,'not a zip');await fs.writeFile(output,'previous book');
  const before=(await fs.readdir(os.tmpdir())).filter(n=>n.startsWith('pdfmaker-convert-')).sort();
  await assert.rejects(buildKindle({book:{chapters:[]},format:'mobi',epubPath:input,outPath:output}),/Не удалось создать MOBI/);
  assert.equal(await fs.readFile(output,'utf8'),'previous book');
  assert.deepEqual((await fs.readdir(os.tmpdir())).filter(n=>n.startsWith('pdfmaker-convert-')).sort(),before);
});

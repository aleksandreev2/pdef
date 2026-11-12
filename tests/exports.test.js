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
    assert.match(text, /Документ создан с помощью <a l:href="https:\/\/github\.com\/aleksandreev2\/pdef"><strong>PDeF<\/strong><\/a>\./);
    assert.match(text, /Разработчик — <a l:href="https:\/\/ranobelib\.me\/ru\/user\/726236"><strong>dollar<\/strong><\/a>/);
    assert.match(text, /владелец команды «<a l:href="https:\/\/ranobelib\.me\/ru\/team\/11969--dom-nekromanta">Дом Некроманта<\/a>»\./);
    const imported=await importSources([report.fb2.path]);
    assert.equal(imported.title,'Новая книга & путь');assert.equal(imported.chapters.length,2);
    assert.ok(imported.chapters.flatMap(c=>c.blocks).some(b=>b.type==='image'));
  } else {
    assert.ok(text.includes('* * *'));
    assert.ok(text.includes('Документ создан с помощью PDeF.\r\nРазработчик — dollar\r\nвладелец команды «Дом Некроманта».\r\n\r\n' +
      'https://github.com/aleksandreev2/pdef\r\nhttps://ranobelib.me/ru/user/726236\r\nhttps://ranobelib.me/ru/team/11969--dom-nekromanta'));
  }
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

test('FB2 compatibility exports supplementary graphemes inline and restores their text on import', async t => {
  const dir = await fixture(t);
  const text = '[002] — 🤨 🤭 🤨 👩🏽‍💻';
  const file = path.join(dir, 'chapter.txt');
  await fs.writeFile(file, `Глава 8. Проход\n\n${text}\n\n* * *\n\nПродолжение текста.`);
  await analyze([file]);
  const options = { meta: {}, outDir: dir, formats: { pdf: false, epub: false, fb2: true } };
  const regular = await build(options);
  assert.match(await fs.readFile(regular.fb2.path, 'utf8'), /🤨 🤭 🤨 👩🏽‍💻/u);
  const report = await build({ ...options, fb2Compatibility: true });
  const xml = await fs.readFile(report.fb2.path, 'utf8');
  assert.equal(report.qa.fb2.ok, true, JSON.stringify(report.qa.fb2.checks));
  assert.doesNotMatch(xml, /[\u{10000}-\u{10ffff}]/u);
  assert.equal((xml.match(/<image l:href="#pdef-glyph-/g) || []).length, 4);
  assert.equal((xml.match(/<binary id="pdef-glyph-/g) || []).length, 3);
  assert.match(xml, /<p>\* \* \*<\/p>/);
  const imported = await importSources([report.fb2.path]);
  assert.ok(imported.chapters[0].blocks.some(block => blockText(block) === text));
});

test('EPUB embeds reusable PNG ornaments and emoji for reading apps that drop inline SVG and glyphs', async t => {
  const dir = await fixture(t);
  const file = path.join(dir, 'chapter.txt');
  await fs.writeFile(file, 'Глава 8. Проход\n\n[002] — 🤨 🤭 🤨\n\n* * *\n\nПродолжение текста.');
  await analyze([file]);
  const kindle = Boolean(await require('../src/core/export/kindle').findConverter());
  const report = await build({ meta: {}, style: { genre: 'litrpg' }, outDir: dir, formats: { pdf: false, epub: true, mobi: kindle, azw3: kindle } });
  const zip = await JSZip.loadAsync(await fs.readFile(report.epub.path));
  const read = name => zip.file(`EPUB/${name}`).async('string');
  const chapter = await read('text/ch001.xhtml');
  const title = await read('text/title.xhtml');
  const manifest = await read('package.opf');
  assert.doesNotMatch(chapter + title, /<svg\b/);
  for (const name of ['pdef-ornament-opener', 'pdef-ornament-divider', 'pdef-glyph-1f928', 'pdef-glyph-1f92d']) {
    assert.match(chapter, new RegExp(`src="../images/${name}\\.png"`));
    assert.match(manifest, new RegExp(`href="images/${name}\\.png" media-type="image/png"`));
    const png = await zip.file(`EPUB/images/${name}.png`).async('nodebuffer');
    assert.equal(png.readUInt32BE(0), 0x89504e47);
    assert.equal(png[25], 6, 'RGBA PNG');
  }
  assert.match(title, /pdef-ornament-opener\.png/);
  assert.equal((chapter.match(/pdef-glyph-1f928\.png/g) || []).length, 2);
  assert.match(chapter, /alt="🤨"/u);
  assert.equal(report.qa.epub.ok, true, JSON.stringify(report.qa.epub.checks));
  if (kindle) for (const format of ['mobi', 'azw3']) assert.equal(report.qa[format].ok, true, JSON.stringify(report.qa[format].checks));
});
test('export with no selected formats fails before creating files',async t=>{
  const dir=await fixture(t);
  await assert.rejects(build({meta:{},outDir:path.join(dir,'no-output'),formats:{pdf:false,epub:false,fb2:false,mobi:false,azw3:false,txt:false}}),/Выберите.*формат/i);
  await assert.rejects(fs.access(path.join(dir,'no-output')));
});

test('multiple formats go into a novel folder and a single format stays in the root',async t=>{
  const dir=await fixture(t),root=path.join(dir,'permanent-output');
  const multi=await build({meta:{title:'Сказ бессмертного'},outDir:root,formats:{pdf:false,epub:false,fb2:true,txt:true}});
  assert.equal(path.dirname(multi.fb2.path),path.join(root,'Сказ бессмертного'));
  assert.equal(path.dirname(multi.txt.path),path.join(root,'Сказ бессмертного'));
  assert.equal(multi.outDir,path.join(root,'Сказ бессмертного'));
  assert.equal((await fs.readdir(multi.outDir)).length,2);
  const other=await build({meta:{title:'Другая новелла'},outDir:root,formats:{pdf:false,epub:false,fb2:true,txt:true}});
  assert.equal(path.dirname(other.txt.path),path.join(root,'Другая новелла'));
  const single=await build({meta:{title:'Одна книга'},outDir:root,formats:{pdf:false,epub:false,txt:true}});
  assert.equal(path.dirname(single.txt.path),root);
  assert.equal(single.outDir,root);
  assert.ok((await fs.readFile(multi.txt.path,'utf8')).includes('Сказ бессмертного'));
});

test('novel folder names stay inside the output root and work on Windows',async t=>{
  const dir=await fixture(t),root=path.join(dir,'permanent-output');
  for(const [title,folder] of [['../Вечный: путь? .','Вечный путь'],['..','Книга'],['CON','CON_'],['CON.txt','CON_.txt'],['COM1.story','COM1_.story']]){
    const report=await build({meta:{title},outDir:root,formats:{pdf:false,epub:false,fb2:true,txt:true}});
    assert.equal(path.dirname(report.txt.path),path.join(root,folder));
    assert.equal((await fs.readFile(report.txt.path,'utf8')).includes(title),true);
  }
});

test('a long novel title with an emoji produces paths the report can open',async t=>{
  const dir=await fixture(t),root=path.join(dir,'permanent-output');
  for(const [title,folder] of [['A'.repeat(99)+'📚','A'.repeat(99)+'📚'],['A'.repeat(119)+'📚','A'.repeat(100)]]){
    const report=await build({meta:{title},outDir:root,formats:{pdf:false,epub:false,fb2:true,txt:true}});
    assert.equal(report.outDir,path.join(root,folder));
    assert.doesNotThrow(()=>encodeURIComponent(report.txt.path));
    await fs.access(report.txt.path);
  }
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
    const blocks=imported.chapters.flatMap(c=>c.blocks);
    const text=blocks.map(blockText).join(' ');
    assert.ok(text.includes('За окном светало.'));assert.ok(text.includes('Он отправился в путь.'));assert.ok(!text.includes('Этот текст не должен'));
    assert.ok(text.includes('владелец команды «Дом Некроманта».'));
    assert.ok(blocks.some(b => b.runs?.some(r => r.text === 'Дом Некроманта' && r.link === 'https://ranobelib.me/ru/team/11969--dom-nekromanta')));
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
  const conversionTemp=path.join(dir,'conversion-temp');
  await fs.mkdir(conversionTemp);
  // Other test files also convert books in parallel; inspect only this test's workspace.
  t.mock.method(os,'tmpdir',()=>conversionTemp);
  await assert.rejects(buildKindle({book:{chapters:[]},format:'mobi',epubPath:input,outPath:output}),/Не удалось создать MOBI/);
  assert.equal(await fs.readFile(output,'utf8'),'previous book');
  assert.deepEqual(await fs.readdir(conversionTemp),[]);
});

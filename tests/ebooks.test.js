'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const JSZip = require('jszip');
const iconv = require('iconv-lite');
const { importSources } = require('../src/core/import');
const { blockText } = require('../src/core/model');
const { kindleFixture } = require('./helpers/kindle-fixtures');
const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
const fb2 = `<?xml version="1.0" encoding="utf-8"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink"><description><title-info><book-title>Начало пути</book-title><coverpage><image l:href="#cover"/></coverpage></title-info></description><body><section><title><p>Глава 1. Рассвет</p></title><p>За окном <strong>медленно</strong> светало &amp; становилось теплее.</p><image l:href="#cover"/></section><section><title><p>Глава 2. Дорога</p></title><p><emphasis>Он вышел</emphasis> из дома.</p></section></body><body name="notes"><section id="n1"><title><p>Примечание 1</p></title><p>Текст примечания.</p></section></body><binary id="cover" content-type="image/png">${pixel}</binary></FictionBook>`;
async function dir(t) { const d = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfmaker-ebook-test-')); t.after(async () => { assert.equal(path.dirname(await fs.realpath(d)).toLowerCase(), (await fs.realpath(os.tmpdir())).toLowerCase()); await fs.rm(d, { recursive: true, force: true }); }); return d; }
async function read(t, name, data) { const file = path.join(await dir(t), name); await fs.writeFile(file, data); return importSources([file]); }
test('FB2 imports chapters, names, inline formatting, images, cover and notes', async t => {
  const book = await read(t, 'export.fb2', Buffer.from(fb2));
  assert.equal(book.chapters.length, 3);
  assert.deepEqual(book.chapters.slice(0,2).map(c=>[c.number,c.title]), [[1,'Рассвет'],[2,'Дорога']]);
  assert.ok(book.chapters[0].blocks.some(b => b.runs?.some(r => r.b && r.text === 'медленно')));
  assert.ok(book.chapters[1].blocks.some(b => b.runs?.some(r => r.i && r.text === 'Он вышел')));
  assert.ok(book.chapters[0].blocks.some(b => b.type === 'image'));
  assert.equal(book.assets.size, 1);
  assert.equal(book.loose[0].assetId, [...book.assets.keys()][0]);
  assert.ok(book.chapters[2].blocks.map(blockText).join(' ').includes('Текст примечания.'));
});
test('FB2 honors its declared Windows-1251 encoding and namespace prefixes', async t => {
  const xml = fb2.replace('encoding="utf-8"', 'encoding="windows-1251"').replace(/(<\/?)(FictionBook|body|section|title|p|description|title-info|book-title|coverpage|image|binary|strong|emphasis)(?=[\s>])/g, '$1fb:$2').replace('<fb:FictionBook ', '<fb:FictionBook xmlns:fb="http://www.gribuser.ru/xml/fictionbook/2.0" ');
  const book = await read(t, 'book.FB2', iconv.encode(xml, 'win1251'));
  assert.equal(book.chapters[0].title, 'Рассвет');
  assert.ok(book.chapters[0].blocks.map(blockText).join(' ').includes('светало & становилось теплее.'));
});
for (const opts of [{}, {compressed:true}, {noExth:true}, {kf8:true}]) {
  test(`Kindle imports real ${opts.kf8 ? 'KF8/AZW3' : 'MOBI'} records ${JSON.stringify(opts)}`, async t => {
    const book = await read(t, opts.kf8 ? 'export.azw3' : 'export.mobi', kindleFixture(['<h2>Глава 1. Рассвет</h2><p>Первая <b>глава</b>.</p>', '<h2>Глава 2. Дорога</h2><p>Вторая <i>глава</i>.</p>'], opts));
    assert.equal(book.chapters.length, 2);
    assert.deepEqual(book.chapters.map(c=>[c.number,c.title]), [[1,'Рассвет'],[2,'Дорога']]);
    assert.ok(book.chapters[0].blocks.map(blockText).join(' ').includes('Первая глава.'));
    assert.ok(book.chapters[1].blocks.some(b=>b.runs?.some(r=>r.i)));
  });
}
test('TXT still reads Cyrillic in UTF-8 and Windows-1251', async t => {
  for (const enc of ['utf8','win1251']) {
    const book = await read(t, 'export.txt', iconv.encode('Глава 9. Начало\n\nРусский текст главы.', enc));
    assert.equal(book.chapters[0].number,9);
    assert.equal(book.chapters[0].title,'Начало');
    assert.ok(book.chapters[0].blocks.map(blockText).join(' ').includes('Русский текст главы.'));
  }
});
test('KF8 imports body text when its header has ordinary stylesheet links', async t => {
  const book = await read(t,'style.azw3',kindleFixture(['<h2>Глава 1. Начало</h2><p>Обычный текст.</p>'],{kf8:true,head:'<link rel="stylesheet" href="style.css"/>'}));
  assert.equal(book.chapters[0].title,'Начало');
  assert.ok(book.chapters[0].blocks.map(blockText).join(' ').includes('Обычный текст.'));
});

test('KF8 resolves base32 SVG flows with letter IDs and IDs beyond 31 without recursion', async t => {
  const flows=Array(32).fill('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/></svg>');
  const wrapper='<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="kindle:embed:0001?mime=image/png"/></svg>';
  flows[9]=wrapper;flows[31]=wrapper;
  const book=await read(t,'many-resources.azw3',kindleFixture(['<h2>Глава 1. Начало</h2><p>Текст после проверки.</p><img src="kindle:flow:000A?mime=image/svg+xml"/><img src="kindle:flow:0010?mime=image/svg+xml"/>'],{kf8:true,flows,images:[Buffer.from(pixel,'base64')]}));
  assert.equal(book.chapters[0].include,true);
  assert.equal(book.chapters[0].blocks.filter(b=>b.type==='image').length,2);
  assert.ok(book.chapters[0].blocks.map(blockText).join(' ').includes('Текст после проверки.'));
});

test('KF8 embedded images beyond record 31 use base32 IDs', async t => {
  const images=Array(32).fill(Buffer.from('not an image'));images[31]=Buffer.from(pixel,'base64');
  const book=await read(t,'many-images.azw3',kindleFixture(['<h2>Глава 1. Начало</h2><p>Сохраняем иллюстрацию.</p><img src="kindle:embed:0010?mime=image/png"/>'],{kf8:true,images}));
  assert.equal(book.chapters[0].include,true);
  const image=book.chapters[0].blocks.find(b=>b.type==='image');assert.ok(image);
  assert.deepEqual(book.assets.get(image.assetId).data,Buffer.from(pixel,'base64'));
});

test('KF8 cyclic resources are rejected before overflowing the stack', async t => {
  const book=await read(t,'cycle.azw3',kindleFixture(['<p>Текст.</p><img src="kindle:flow:0001?mime=image/svg+xml"/>'],{kf8:true,flows:['<svg><image href="kindle:flow:0001?mime=image/svg+xml"/></svg>']}));
  assert.equal(book.chapters[0].include,false);
  assert.ok(book.chapters[0].issues.some(s=>/циклическ/i.test(s)));
});
test('ZIP collects all four requested formats', async t => {
  const zip = new JSZip(); zip.file('book.fb2',fb2); zip.file('book.mobi',kindleFixture(['<h2>Глава 4. MOBI</h2><p>Четвёртая глава.</p>'])); zip.file('book.azw3',kindleFixture(['<h2>Глава 5. AZW3</h2><p>Пятая глава.</p>'],{kf8:true})); zip.file('006.txt','Глава 6. TXT\n\nШестая глава.');
  const book = await read(t,'books.zip',await zip.generateAsync({type:'nodebuffer'}));
  assert.equal(book.chapters.length,6);
  assert.ok(book.chapters.some(c=>c.title==='AZW3'));
  assert.ok(book.chapters.some(c=>c.title==='MOBI'));
});
test('invalid and encrypted ebooks are reported and excluded, without losing other files', async t => {
  const zip = new JSZip(); zip.file('broken.fb2','<FictionBook><body><section>'); zip.file('broken.mobi',Buffer.from('not a Kindle book')); zip.file('protected.azw3',kindleFixture(['<p>Текст.</p>'],{kf8:true,encrypted:true})); zip.file('001.txt','Глава 1. Текст\n\nТекст нормальной главы.');
  const book = await read(t,'bad.zip',await zip.generateAsync({type:'nodebuffer'}));
  assert.equal(book.chapters.length,4);
  assert.equal(book.chapters.filter(c=>c.include).length,1);
  assert.ok(book.chapters.some(c=>c.issues.some(s=>/DRM|защищ/i.test(s))));
  assert.ok(book.chapters.filter(c=>!c.include).every(c=>c.issues.some(s=>s.startsWith('Файл не разобран'))));
});
test('FB2 preserves nested section order and text outside child sections', async t => {
  const xml = '<FictionBook><body><section><title><p>Часть первая</p></title><p>Вступление.</p><section><title><p>Глава 1. Начало</p></title><p>Глава.</p></section><p>После вложенной главы.</p></section></body></FictionBook>';
  const book = await read(t,'nested.fb2',Buffer.from(xml));
  assert.ok(book.chapters.flatMap(c=>c.blocks.map(blockText)).join('|').includes('Вступление.|Глава.|После вложенной главы.'));
});
test('FB2 preserves inline images and text on both sides', async t => {
  const book = await read(t,'inline.fb2',Buffer.from(fb2.replace('За окном <strong>','До картинки <image l:href="#cover"/> после картинки <strong>')));
  const blocks=book.chapters[0].blocks;
  assert.equal(blocks.filter(b=>b.type==='image').length,2);
  assert.ok(blocks.map(blockText).join('|').includes('До картинки|'));
  assert.ok(blocks.map(blockText).join(' ').includes('после картинки'));
});
for (const kf8 of [false,true]) test(`Kindle keeps embedded images and cover at offset zero (${kf8?'KF8':'MOBI'})`,async t=>{
  const images=[Buffer.from(pixel,'base64')];
  if(kf8) images.push(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><image xlink:href="kindle:embed:0001?mime=image/png"/></svg>'));
  const img=kf8?'<img src="kindle:embed:0002?mime=image/svg+xml"/>':'<img recindex="1"/>';
  const book=await read(t,kf8?'images.azw3':'images.mobi',kindleFixture([`<h2>Глава 1. Иллюстрация</h2><p>До картинки.</p>${img}<p>После картинки.</p>`],{kf8,images}));
  assert.equal(book.chapters[0].include,true);
  assert.equal(book.chapters[0].blocks.filter(b=>b.type==='image').length,1);
  assert.equal(book.loose.length,1);
  assert.equal(book.assets.size,1);
  assert.ok(!book.chapters[0].issues.some(s=>/Иллюстрация не импортирована/.test(s)));
});
test('ebook named headings become section titles without a repeated body heading',async t=>{
  const xml='<FictionBook><body><section><title><p>Рассвет</p></title><p>Утро настало.</p><subtitle>Следующий день</subtitle><p>Дальше.</p></section></body></FictionBook>';
  for(const [name,data] of [['named.fb2',Buffer.from(xml)],['named.azw3',kindleFixture(['<h2>Рассвет</h2><p>Утро настало.</p><h3>Следующий день</h3><p>Дальше.</p>'],{kf8:true})]]){
    const book=await read(t,name,data);
    assert.equal(book.chapters[0].title,'Рассвет');
    assert.ok(!book.chapters[0].blocks.some(b=>blockText(b)==='Рассвет'));
    assert.ok(book.chapters[0].blocks.some(b=>blockText(b)==='Следующий день'));
  }
});
test('ebook author and language survive import and EPUB export with a title override',async t=>{
  const {analyze,build}=require('../src/core/pipeline');
  const xml='<FictionBook><description><title-info><book-title>Original title</book-title><author><first-name>Test</first-name><last-name>Author</last-name></author><lang>en</lang></title-info></description><body><section><title><p>Chapter 1. Morning</p></title><p>Morning came.</p></section></body></FictionBook>';
  const folder=await dir(t);
  for(const [name,data] of [['metadata.fb2',Buffer.from(xml)],['metadata.azw3',kindleFixture(['<h2>Chapter 1. Morning</h2><p>Morning came.</p>'],{kf8:true,title:'Original title',author:'Test Author',language:'en'})]]) {
    const file=path.join(folder,name); await fs.writeFile(file,data);
    const book=await importSources([file]);
    assert.equal(book.author,'Test Author'); assert.equal(book.language,'en');
    const analysis=await analyze([file]); assert.equal(analysis.suggestedTitle,'Original title');
    const report=await build({meta:{title:'Custom title'},outDir:folder,formats:{pdf:false,epub:true}});
    const zip=await JSZip.loadAsync(await fs.readFile(report.epub.path));
    const opf=await zip.file('EPUB/package.opf').async('string');
    assert.ok(opf.includes('<dc:language>en</dc:language>'));
    assert.ok(opf.includes('>Test Author</dc:creator>'));
    assert.ok(opf.includes('<dc:title>Custom title</dc:title>'));
    assert.ok(report.qa.epub.checks.find(c=>c.name.startsWith('Язык книги')).ok);
  }
});
test('Kindle definition lists preserve separate labels and values',async t=>{
  const book=await read(t,'stats.azw3',kindleFixture(['<h2>Глава 1. Персонаж</h2><dl><dt>Сила</dt><dd>10</dd><dt>Ловкость</dt><dd>20</dd></dl>'],{kf8:true}));
  assert.deepEqual(book.chapters[0].blocks.map(blockText),['Сила','10','Ловкость','20']);
});
test('missing Kindle illustration keeps the book text and records a warning',async t=>{
  for(const [kf8,img,images] of [[false,'<img src="https://example.test/missing.png"/>',[]],[true,'<img src="kindle:embed:0002?mime=image/svg+xml"/>',[Buffer.from(pixel,'base64'),Buffer.from('<svg><image href="missing.png"/></svg>')]]]){
    const book=await read(t,kf8?'missing.azw3':'missing.mobi',kindleFixture([`<h2>Глава 1. Текст</h2><p>Сохранить этот текст.</p>${img}<p>Следующий абзац.</p>`],{kf8,images}));
    assert.equal(book.chapters[0].include,true);
    assert.ok(book.chapters[0].blocks.map(blockText).join(' ').includes('Сохранить этот текст. Следующий абзац.'));
    assert.ok(book.chapters[0].issues.some(s=>s.startsWith('Иллюстрация не импортирована')));
  }
});
test('FB2 defaults to XML UTF-8 and recognizes UTF-16 without a declaration',async t=>{
  const xml='<FictionBook><body><section><title><p>Morning</p></title><p>Elle était là. Café français. 日本語。</p></section></body></FictionBook>';
  for(const enc of ['utf8','utf16le','utf16be']) {
    const book=await read(t,'unicode.fb2',iconv.encode(xml,enc));
    assert.ok(book.chapters[0].blocks.map(blockText).join(' ').includes('Elle était là. Café français. 日本語。'));
  }
});
test('Kindle preserves a parent part heading when a child heading supplies the chapter title',async t=>{
  const book=await read(t,'parts.azw3',kindleFixture(['<h1>Part I</h1><h2>Chapter 1. Morning</h2><p>Morning came.</p>'],{kf8:true}));
  assert.equal(book.chapters[0].title,'Morning');
  assert.ok(book.chapters[0].blocks.some(b=>blockText(b)==='Part I'));
  assert.ok(book.chapters[0].blocks.some(b=>blockText(b)==='Morning came.'));
});

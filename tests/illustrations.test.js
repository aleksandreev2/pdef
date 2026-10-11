'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const JSZip=require('jszip');
const {createCanvas,loadImage}=require('@napi-rs/canvas');
const {analyze,build,getSession}=require('../src/core/pipeline');
const {makeChapter,KIND}=require('../src/core/model');

async function fixture(t) {
  const parent=await fs.realpath(os.tmpdir());
  const dir=await fs.mkdtemp(path.join(parent,'pdfmaker-images-test-'));
  t.after(async()=>{
    assert.equal(path.dirname(await fs.realpath(dir)).toLowerCase(),parent.toLowerCase());
    await fs.rm(dir,{recursive:true,force:true});
  });
  const file=path.join(dir,'001.txt');
  await fs.writeFile(file,'Глава 1. Начало\n\nТекст до иллюстрации.\n\nТекст после иллюстрации.');
  await analyze([file]);
  const book=getSession().book;
  const canvas=createCanvas(1800,900),ctx=canvas.getContext('2d');
  const pixels=ctx.createImageData(1800,900);
  let seed=17;
  for(let i=0;i<pixels.data.length;i+=4) {
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    pixels.data[i]=seed&255;pixels.data[i+1]=(seed>>>8)&255;pixels.data[i+2]=(seed>>>16)&255;pixels.data[i+3]=255;
  }
  ctx.putImageData(pixels,0,0);
  const data=await canvas.encode('png');
  book.assets.set('picture',{id:'picture',ext:'png',mime:'image/png',data});
  const cover=createCanvas(12,20);cover.getContext('2d').fillRect(0,0,12,20);
  book.assets.set('cover',{id:'cover',ext:'png',mime:'image/png',data:await cover.encode('png')});
  book.cover={assetId:'cover'};
  book.chapters[0].blocks.splice(1,0,{type:'image',assetId:'picture',alt:'Illustration',w:1800,h:900});
  book.chapters.push(makeChapter({id:'gallery',kind:KIND.COVER_GALLERY,title:'Иллюстрации',blocks:[{type:'image',assetId:'picture'},{type:'sep'}]}));
  book.chapters.push(makeChapter({id:'mixed',kind:KIND.COVER_GALLERY,title:'Примечания',blocks:[{type:'image',assetId:'picture'},{type:'para',runs:[{text:'Текст галереи сохранён.'}]}]}));
  return {dir,book,data,opts:{meta:{title:'Книга'},style:{signature:false},outDir:dir,formats:{pdf:false,epub:true}}};
}

async function epub(file) {
  const zip=await JSZip.loadAsync(await fs.readFile(file));
  const images=Object.keys(zip.files).filter(n=>/^EPUB\/images\/[^/]+$/.test(n));
  const texts=await Promise.all(Object.keys(zip.files).filter(n=>n.endsWith('.xhtml')).map(n=>zip.file(n).async('string')));
  return {zip,images,text:texts.join('\n')};
}

test('without illustrations removes body images and empty galleries, keeping cover and text',async t=>{
  const {opts,book,data}=await fixture(t);
  const report=await build({...opts,illustrations:{version:'without'}});
  const out=await epub(report.epub.path);
  assert.equal(out.images.length,1);
  assert.ok(out.images[0].includes('cover.'));
  assert.ok(!out.text.includes('alt="Illustration"'));
  assert.ok(out.text.includes('Текст до иллюстрации.'));
  assert.ok(out.text.includes('Текст после иллюстрации.'));
  assert.ok(out.text.includes('Текст галереи сохранён.'));
  assert.ok(!out.text.includes('>Иллюстрации<'));
  assert.equal(report.stats.images,0);
  assert.equal(report.qa.epub.ok,true);
  assert.ok(report.epub.path.includes('_без_иллюстраций.epub'));
  assert.equal(book.chapters[0].blocks.filter(b=>b.type==='image').length,1);
  assert.deepEqual(book.assets.get('picture').data,data);
  const normal=await build(opts);
  assert.equal((await epub(normal.epub.path)).images.length,2);
  assert.ok((await epub(normal.epub.path)).text.includes('alt="Illustration"'));
});

test('both versions have separate files and their own QA and statistics',async t=>{
  const {opts}=await fixture(t);
  const report=await build({...opts,illustrations:{version:'both'}});
  assert.equal(report.versions.length,2);
  const [withImages,withoutImages]=report.versions;
  assert.equal(withImages.illustrations.version,'with');
  assert.equal(withoutImages.illustrations.version,'without');
  assert.notEqual(withImages.epub.path,withoutImages.epub.path);
  assert.equal((await epub(withImages.epub.path)).images.length,2);
  assert.equal((await epub(withoutImages.epub.path)).images.length,1);
  assert.equal(withoutImages.stats.images,0);
  assert.ok(withImages.stats.images>0);
  assert.equal(withImages.qa.epub.ok,true);assert.equal(withoutImages.qa.epub.ok,true);
});

test('cover can be omitted explicitly in the version without illustrations',async t=>{
  const {opts}=await fixture(t);
  const report=await build({...opts,illustrations:{version:'without',keepCover:false}});
  const out=await epub(report.epub.path);
  assert.equal(out.images.length,0);
  assert.ok(!out.zip.file('EPUB/text/cover.xhtml'));
  assert.equal(report.qa.epub.ok,true);
});

for(const [compression,maxEdge] of [['balanced',1600],['strong',1000]]) test(`${compression} compression reduces embedded images and preserves proportions`,async t=>{
  const {opts,book,data}=await fixture(t);
  const report=await build({...opts,illustrations:{compression}});
  const out=await epub(report.epub.path);
  const name=out.images.find(n=>!n.includes('cover.'));
  const compressed=await out.zip.file(name).async('nodebuffer');
  assert.ok(compressed.length<data.length/2);
  const image=await loadImage(compressed);
  assert.ok(image.width<=maxEdge);assert.equal(image.width/image.height,2);
  assert.ok(name.endsWith('.jpg'));
  assert.equal(report.qa.epub.ok,true);
  assert.ok(report.illustrations.savedBytes>0);
  assert.deepEqual(book.assets.get('picture').data,data);
});

test('compression preserves transparency and never enlarges tiny images',async t=>{
  const {opts,book}=await fixture(t);
  const canvas=createCanvas(1800,900);canvas.getContext('2d').fillRect(0,0,900,900);
  book.assets.get('picture').data=await canvas.encode('png');
  const originalCover=Buffer.from(book.assets.get('cover').data);
  const report=await build({...opts,illustrations:{compression:'strong'}});
  const out=await epub(report.epub.path);
  const name=out.images.find(n=>!n.includes('cover.'));
  assert.ok(name.endsWith('.png'));
  const img=await loadImage(await out.zip.file(name).async('nodebuffer'));
  assert.ok(img.width<=1000);
  const result=createCanvas(img.width,img.height);result.getContext('2d').drawImage(img,0,0);
  assert.equal(result.getContext('2d').getImageData(img.width-1,0,1,1).data[3],0);
  const cover=await out.zip.file(out.images.find(n=>n.includes('cover.'))).async('nodebuffer');
  assert.ok(cover.length<=originalCover.length);
});

test('compression keeps vector, animated and unreadable assets with a warning for unreadable raster',async t=>{
  const {opts,book}=await fixture(t);
  const assets=[['vector','svg','image/svg+xml',Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>')],['animated','gif','image/gif',Buffer.from('GIF89a')],['broken','png','image/png',Buffer.from('not an image')]];
  book.chapters=book.chapters.slice(0,1);
  book.chapters[0].blocks=book.chapters[0].blocks.filter(b=>b.type!=='image');
  for(const [id,ext,mime,data] of assets) {book.assets.set(id,{id,ext,mime,data});book.chapters[0].blocks.push({type:'image',assetId:id});}
  const report=await build({...opts,illustrations:{compression:'strong'}});
  const out=await epub(report.epub.path);
  for(const [,ext,,data] of assets) assert.deepEqual(await out.zip.file(out.images.find(n=>!n.includes('cover.') && n.endsWith('.'+ext))).async('nodebuffer'),data);
  assert.ok(report.illustrations.warnings.some(w=>w.includes('broken')));
});

test('without illustrations is used consistently by PDF, EPUB and FB2',async t=>{
  const {opts,book}=await fixture(t);
  for(const ch of [book.chapters[0],book.chapters[2]]) ch.blocks.push({type:'para',runs:[{text:'Он вышел на дорогу и увидел вдали старый дом. Вокруг стояла тишина, впереди начинался новый день. '.repeat(3)}]});
  const report=await build({...opts,formats:{pdf:true,epub:true,fb2:true},illustrations:{version:'without'}});
  for(const format of ['pdf','epub','fb2']) assert.equal(report.qa[format].ok,true,JSON.stringify(report.qa[format]));
  const xml=await fs.readFile(report.fb2.path,'utf8');
  assert.ok(xml.includes('<coverpage>'));
  assert.equal((xml.match(/<binary /g)||[]).length,1);
  assert.ok(!xml.match(/<body>[\s\S]*?<image [\s\S]*?<\/body>/));
  assert.equal(report.fb2.chapters,2);
});

test('unknown illustration settings fail before creating output files',async t=>{
  const {opts,dir}=await fixture(t);
  const outDir=path.join(dir,'invalid-output');
  await assert.rejects(build({...opts,outDir,illustrations:{version:'invalid'}}),/верс/i);
  await assert.rejects(build({...opts,outDir,illustrations:{compression:'invalid'}}),/сжат/i);
  await assert.rejects(fs.access(outDir));
});

test('PDF and FB2 embed compressed raster data and leave originals intact',async t=>{
  const {opts,book,data}=await fixture(t);
  const report=await build({...opts,formats:{pdf:true,epub:true,fb2:true},illustrations:{compression:'strong'}});
  const pdf=await fs.readFile(report.pdf.path);
  assert.ok(pdf.includes(Buffer.from('/DCTDecode')));
  assert.ok(pdf.length<data.length/2);
  const {importSources}=require('../src/core/import');
  const fb2=await importSources([report.fb2.path]);
  const illustration=[...fb2.assets.values()].find(a=>a.mime==='image/jpeg');
  assert.ok(illustration);
  assert.ok(illustration.data.length<data.length/2);
  assert.equal((await loadImage(illustration.data)).width,1000);
  assert.deepEqual(book.assets.get('picture').data,data);
});

test('Kindle builds both versions without an EPUB output and retains cover in the text version',async t=>{
  const {findConverter}=require('../src/core/export/kindle');
  if (!await findConverter()) {t.skip('Calibre is not installed');return;}
  const {opts}=await fixture(t);
  const {importSources}=require('../src/core/import');
  const report=await build({...opts,formats:{pdf:false,epub:false,mobi:true,azw3:true},illustrations:{version:'both',compression:'strong'}});
  for(const [index,version] of report.versions.entries()) {
    assert.equal(version.epub,null);
    for(const format of ['mobi','azw3']) {
      assert.equal(version.qa[format].ok,true,JSON.stringify(version.qa[format]));
      const book=await importSources([version[format].path]);
      if(index===1) {
        assert.equal(book.assets.size,1);
        assert.ok(book.loose.length);
        assert.ok(book.chapters.flatMap(c=>c.blocks).filter(b=>b.type==='image').length<=1);
      } else assert.ok(book.assets.size>=2);
    }
  }
});

test('CLI supports both versions and rejects invalid compression before creating files',async t=>{
  const {promisify}=require('node:util');
  const run=promisify(require('node:child_process').execFile);
  const {dir}=await fixture(t);
  const outDir=path.join(dir,'cli-output');
  const cli=path.join(__dirname,'../scripts/cli.js');
  await run(process.execPath,[cli,'--in',path.join(dir,'001.txt'),'--out',outDir,'--title','Книга','--only','epub','--illustrations','both','--image-compression','strong','--no-cover']);
  const files=await fs.readdir(path.join(outDir,'Книга'));
  assert.equal(files.filter(f=>f.endsWith('.epub')).length,2);
  assert.ok(files.some(f=>f.endsWith('_без_иллюстраций.epub')));
  const invalid=path.join(dir,'invalid-cli');
  await assert.rejects(run(process.execPath,[cli,'--in',path.join(dir,'001.txt'),'--out',invalid,'--only','epub','--image-compression','invalid']),e=>e.stderr.includes('Неизвестный режим сжатия'));
  await assert.rejects(fs.access(invalid));
});

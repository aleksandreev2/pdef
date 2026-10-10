'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {buildPdf} = require('../src/core/pdf/build');
const {makeBook} = require('../src/core/model');
const {clampStyle, geometry} = require('../src/core/style');
const {resolveFonts} = require('../src/core/fonts');

test('long team names wrap inside the cover, title and translation page margins', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf-wrap-'));
  t.after(() => fs.rm(dir, {recursive:true, force:true}));
  const style = clampStyle({signature:true});
  const geom = geometry(style);
  const book = makeBook();
  Object.assign(book, {title:'Книга', team:'Герой войны, который ни о чём не жалеет', teamUrl:'https://example.test/team', stats:{words:126275,chapters:94}});
  const outPath = path.join(dir,'book.pdf');
  await buildPdf({book,style,fonts:resolveFonts(style),outPath});
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({data:new Uint8Array(await fs.readFile(outPath)),isEvalSupported:false}).promise;
  t.after(() => pdf.destroy());
  for (const pageNo of [1,2,4]) {
    const page = await pdf.getPage(pageNo);
    const {items} = await page.getTextContent();
    const text = items.filter(i=>i.str.trim());
    assert.ok(text.map(i=>i.str).join(' ').replace(/\s+/g,' ').includes(book.team));
    for (const item of text) {
      assert.ok(item.transform[4] >= geom.contentX - 0.5, `page ${pageNo}: left overflow: ${item.str}`);
      assert.ok(item.transform[4] + item.width <= geom.contentX + geom.contentW + 0.5, `page ${pageNo}: right overflow: ${item.str}`);
    }
    const links = (await page.getAnnotations()).filter(a=>a.url===book.teamUrl);
    if(pageNo===2) {
      assert.ok(links.length>=2, 'each wrapped team line retains its link');
      for(const link of links) {
        assert.ok(link.rect[0]>=geom.contentX-0.5);
        assert.ok(link.rect[2]<=geom.contentX+geom.contentW+0.5);
      }
    }
  }
});



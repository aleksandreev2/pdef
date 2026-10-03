'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const PDFDocument = require('pdfkit');
const {clampStyle, geometry} = require('../src/core/style');
const {resolveFonts} = require('../src/core/fonts');
const {createMeasurer} = require('../src/core/pdf/typeset');
const {buildChapterFlow, paginate} = require('../src/core/pdf/layout');
const {chapterXhtml} = require('../src/core/epub/templates');
const {GENRES} = require('../src/core/genres');
const {svgPageFrame} = require('../src/core/signature');
const {Resvg} = require('@resvg/resvg-js');

function context(signature = true) {
  const style = clampStyle({genre: 'romance', signature});
  const doc = new PDFDocument({autoFirstPage: false});
  const m = createMeasurer(doc, resolveFonts(style));
  return {style, geom: geometry(style), measure: m.width, assets: new Map()};
}
test('clean note uses its full inner width, including every continued page', () => {
  const ctx = context();
  const chapter = {id:'one', kind:'chapter', number:1, title:'Начало', blocks:[{
    type:'system', lines:Array.from({length:150}, (_,i) => [{text:`Строка ${i}: открыта новая глава и начинается путешествие.`}]),
  }]};
  const items = buildChapterFlow(chapter,ctx);
  const panel = items.find(i=>i.t==='system');
  assert.equal(panel.iconColumn,0);
  assert.ok(Math.abs(panel.inner + panel.iconColumn + panel.pad*2 - ctx.geom.contentW) < 0.001);
  const {pages} = paginate([{chapter, items}],ctx);
  assert.ok(pages.length > 3);
  const chunks = pages.flatMap(p=>p.parts.filter(i=>i.t==='system'));
  assert.equal(chunks.flatMap(c=>c.lines).length, panel.lines.length);
  for(const chunk of chunks) {
    assert.equal(chunk.iconColumn,panel.iconColumn);
    assert.ok(chunk.y+chunk.h <= ctx.geom.contentBottom+0.01);
    for(const line of chunk.lines) for(const w of line.items) assert.ok(w.x+w.w <= panel.inner+0.1);
  }
});
test('turning ornaments off removes icon space and SVG decoration from EPUB', () => {
  const ctx=context(false);
  const chapter={id:'one',kind:'chapter',number:1,title:'Начало',blocks:[{type:'system',lines:[[{text:'Запись'}]]},{type:'sep'}]};
  const panel=buildChapterFlow(chapter,ctx).find(i=>i.t==='system');
  assert.equal(panel.iconColumn,0);
  const html=chapterXhtml({language:'ru'},chapter,ctx.style,()=>null);
  assert.ok(!html.includes('<svg'));
  assert.ok(html.includes('Запись'));
});
test('EPUB preserves text and alignment without system icons or page corner decorations', () => {
  const chapter={id:'one',kind:'chapter',number:1,title:'Начало',blocks:[{type:'para',align:'center',runs:[{text:'Новая история.'}]},{type:'system',lines:[[{text:'Запись',b:true}],[{text:'Открыта глава.'}]]}]};
  const html=chapterXhtml({language:'ru'},chapter,context().style,()=>null);
  assert.ok(!html.includes('system-icon'));
  assert.ok(!html.includes('panel-corner'));
  assert.ok(!html.includes('chapter-corner'));
  assert.ok(html.includes('role="note"'));
  assert.ok(html.includes('text-align:center'));
  assert.ok(html.includes('Открыта глава.'));
});
test('a long chapter title shrinks to leave room for opening prose', () => {
  const ctx=context();
  const chapter={id:'long',kind:'chapter',number:1,title:'Последняя надежда героя '.repeat(7).trim(),blocks:[{type:'para',runs:[{text:'Он вышел из дома.'}]}]};
  const items=buildChapterFlow(chapter,ctx),opener=items[0];
  assert.ok(opener.h <= ctx.geom.contentH-2*ctx.geom.lineStep);
  assert.ok(opener.titleSize < ctx.style.chapterTitleSize);
});
test('even an exceptionally long heading flows over pages without losing its words', () => {
  const ctx=context();
  const chapter={id:'huge',kind:'chapter',number:1,title:Array.from({length:400},(_,i)=>'Слово'+i).join(' '),blocks:[{type:'para',runs:[{text:'После заголовка.'}]}]};
  const items=buildChapterFlow(chapter,ctx),{pages}=paginate([{chapter,items}],ctx);
  const headings=pages.flatMap(p=>p.parts.filter(i=>i.t==='opener'));
  assert.ok(headings.length>1);
  assert.deepEqual(headings.flatMap(p=>p.titleLines.flatMap(l=>l.items.map(w=>w.text))),items[0].titleLines.flatMap(l=>l.items.map(w=>w.text)));
  for(const page of pages) for(const p of page.parts) assert.ok(p.y+p.h <= ctx.geom.contentBottom+.01,`${p.t}: ${p.y+p.h}`);
});
test('every rendered page frame leaves actual PDF text bounds clear at minimum margins', () => {
  for(const side of [9,10]) for(const genre of GENRES) {
    const geom=geometry(clampStyle({genre:genre.id,marginLeftMm:side,marginRightMm:side}));
    const image=new Resvg(svgPageFrame(genre.accent,genre.id,geom,210)).render();
    const pixels=image.pixels;
    for(let y=210;y<Math.floor(geom.contentBottom);y++) for(let x=Math.ceil(geom.contentX);x<Math.floor(geom.contentX+geom.contentW);x++) {
      assert.equal(pixels[(y*image.width+x)*4+3],0,`${genre.id}, ${side} mm: ${x},${y}`);
    }
  }
});

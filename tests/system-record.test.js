'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const PDFDocument=require('pdfkit');
const {buildBlocks}=require('../src/core/parse/blocks');
const {runsText}=require('../src/core/model');
const {clampStyle,geometry}=require('../src/core/style');
const {resolveFonts}=require('../src/core/fonts');
const {createMeasurer}=require('../src/core/pdf/typeset');
const {buildChapterFlow,paginate}=require('../src/core/pdf/layout');
const {chapterXhtml}=require('../src/core/epub/templates');
const header='[Ча Хваён] [Небесный Демон]';
const mood='[Основной настрой: Вы кажетесь ей ничтожеством. Стоит вам открыть рот — и она разрубит вас пополам.]';
const reply='[Подходящий ответ: «Молчите» <Шанс угодить собеседнику: 100%>]';
const section={id:'one',kind:'chapter',number:1,title:'Начало'};
const raw=text=>({runs:[{text}]});
const rows=block=>block.lines.map(runsText);

test('system records preserve all brackets and separate response probability',()=>{
  const {blocks}=buildBlocks([raw(header),raw(mood),raw(reply)],section);
  assert.equal(blocks.length,1);
  assert.equal(blocks[0].type,'system');
  assert.deepEqual(rows(blocks[0]),[header,mood,'[Подходящий ответ: «Молчите»','<Шанс угодить собеседнику: 100%>]']);
  assert.equal(blocks[0].structured,true);
  assert.ok(blocks[0].lines[0].every(r=>r.b));
  assert.equal(blocks[0].lines[1].filter(r=>r.b).map(r=>r.text).join(''),'[Основной настрой:');
  assert.equal(blocks[0].lines[2].filter(r=>r.b).map(r=>r.text).join(''),'[Подходящий ответ:');
});

test('single-paragraph and HTML soft-break records keep the same field boundaries',()=>{
  for(const separator of [' ','\n']) {
    const {blocks}=buildBlocks([raw([header,mood,reply].join(separator))],section);
    assert.equal(blocks.length,1);
    assert.deepEqual(rows(blocks[0]),[header,mood,'[Подходящий ответ: «Молчите»','<Шанс угодить собеседнику: 100%>]']);
  }
});

test('splitting labels preserves italics, links and every source character except whitespace',()=>{
  const source=[{text:'[Подходящий ',i:true},{text:'ответ: '},{text:'«Молчите»',link:'https://example.test/'},{text:' <Шанс угодить собеседнику: 100%>]'}];
  const {blocks}=buildBlocks([{runs:source}],section);
  assert.deepEqual(rows(blocks[0]),['[Подходящий ответ: «Молчите»','<Шанс угодить собеседнику: 100%>]']);
  assert.ok(blocks[0].lines[0].some(r=>r.i && r.text==='[Подходящий '));
  assert.ok(blocks[0].lines[0].some(r=>r.link==='https://example.test/' && r.text==='«Молчите»'));
  assert.equal(rows(blocks[0]).join('').replace(/\s/g,''),runsText(source).replace(/\s/g,''));
  assert.deepEqual(source[0],{text:'[Подходящий ',i:true});
});

test('an open bracket includes wrapped continuation, but ordinary following prose remains outside the panel',()=>{
  const {blocks}=buildBlocks([raw(header),raw('[Основной настрой: Вы кажетесь ей'),raw('ничтожеством.]'),raw('Подходящий ответ: «Молчите» <Шанс угодить собеседнику: 100%>'),raw('Он вышел из комнаты.')],section);
  assert.equal(blocks.length,2);
  assert.deepEqual(rows(blocks[0]),[header,'[Основной настрой: Вы кажетесь ей ничтожеством.]','Подходящий ответ: «Молчите»','<Шанс угодить собеседнику: 100%>']);
  assert.equal(blocks[1].type,'para');assert.equal(runsText(blocks[1].runs),'Он вышел из комнаты.');
});

test('ordinary bracketed lines preserve delimiters without changing prose or table rows',()=>{
  const {blocks}=buildBlocks([raw('[Сила: 10]'),raw('【Открыта глава】'),raw('《Новый уровень》'),raw('Подходящий ответ: это обычное предложение.'),{table:true,lines:[[{text:'Значение: 10'}]]}],section);
  assert.deepEqual(rows(blocks[0]),['[Сила: 10]','【Открыта глава】','《Новый уровень》']);
  assert.equal(blocks[1].type,'para');
  assert.deepEqual(blocks[2].lines,[[{text:'Значение: 10'}]]);
});

test('PDF system records have field spacing, intact words and safe pagination',()=>{
  const {blocks}=buildBlocks([raw(header),raw(mood),raw(reply)],section);
  const chapter={...section,blocks};
  const style=clampStyle({signature:false,hyphenate:true,systemSize:11.5});
  const doc=new PDFDocument({autoFirstPage:false});
  const m=createMeasurer(doc,resolveFonts(style));
  const ctx={style,geom:geometry(style),measure:m.width,assets:new Map()};
  const items=buildChapterFlow(chapter,ctx);
  const panel=items.find(p=>p.t==='system');
  assert.equal(panel.lines.filter(l=>!l.items.length).length,3);
  const words=panel.lines.flatMap(l=>l.items.map(w=>w.text));
  assert.ok(words.includes('ничтожеством.'));
  assert.ok(!words.includes('ничи-'));
  const {pages}=paginate([{chapter,items}],ctx);
  for(const chunk of pages.flatMap(p=>p.parts.filter(p=>p.t==='system'))) assert.ok(chunk.y+chunk.h<=ctx.geom.contentBottom+.01);
  const html=chapterXhtml({language:'ru'},chapter,style,()=>null);
  assert.ok(html.includes('<strong>[Ча Хваён] [Небесный Демон]</strong>'));
  assert.ok(html.includes('&lt;Шанс угодить собеседнику:'));
  assert.ok(html.includes('100%&gt;]'));
});

test('a long structured record continues across pages without losing any lines',()=>{
  const source=[raw(header),...Array.from({length:45},(_,i)=>raw(`[Основной настрой: Запись ${i+1}. ${'Продолжение записи. '.repeat(5)}]`))];
  const {blocks}=buildBlocks(source,section);
  const chapter={...section,blocks};
  const style=clampStyle({signature:false,hyphenate:true,systemSize:11.5});
  const doc=new PDFDocument({autoFirstPage:false});
  const m=createMeasurer(doc,resolveFonts(style));
  const ctx={style,geom:geometry(style),measure:m.width,assets:new Map()};
  const items=buildChapterFlow(chapter,ctx);
  const panel=items.find(p=>p.t==='system');
  const {pages}=paginate([{chapter,items}],ctx);
  const chunks=pages.flatMap(p=>p.parts.filter(p=>p.t==='system'));
  assert.ok(chunks.length>2);
  assert.deepEqual(chunks.flatMap(p=>p.lines),panel.lines);
  for(const chunk of chunks) assert.ok(chunk.y+chunk.h<=ctx.geom.contentBottom+.01);
});

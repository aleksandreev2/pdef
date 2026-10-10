'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {GENRES} = require('../src/core/genres');
const {clampStyle} = require('../src/core/style');
const {svgTitleMark,svgSceneBreak,svgPageFrame,svgSystemIcon,svgPanelCorner,svgFolio} = require('../src/core/signature');
const {chapterXhtml} = require('../src/core/epub/templates');
const {Resvg} = require('@resvg/resvg-js');

test('erotica is selectable and produces its own visible artwork in every slot', () => {
  assert.ok(GENRES.some(g=>g.id==='erotica' && g.name==='Эротика'));
  const style=clampStyle({genre:'erotica'});
  assert.equal(style.genre,'erotica');
  assert.equal(style.accent,'#893D59');
  for(const render of [svgTitleMark,svgSceneBreak,svgPageFrame,svgSystemIcon,svgPanelCorner,svgFolio]) {
    const svg=render('#123456','erotica');
    assert.notEqual(svg,render('#123456','romance'));
    assert.notEqual(svg,render('#123456','fantasy'));
    const pixels=new Resvg(svg,{fitTo:{mode:'width',value:200}}).render().pixels;
    assert.ok(pixels.some((v,i)=>i%4===3 && v>0), 'artwork must be visible');
    assert.ok(svg.includes('#123456'));
  }
});

test('EPUB erotica preserves prose and uses the selected scene divider', () => {
  const chapter={kind:'chapter',number:1,title:'Начало',blocks:[{type:'para',runs:[{text:'Текст книги.'}]},{type:'sep'}]};
  const style=clampStyle({genre:'erotica'});
  const html=chapterXhtml({language:'ru'},chapter,style,()=>null);
  assert.ok(html.includes('Текст книги.'));
  assert.ok(html.includes(svgSceneBreak(style.accent,'erotica')));
});

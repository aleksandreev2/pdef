'use strict';
const fs=require('fs/promises'),crypto=require('crypto');
const {Resvg}=require('@resvg/resvg-js');
const {chapterLabel}=require('../model');
const {svgTitleMark,svgSceneBreak}=require('../signature');
const esc=s=>String(s || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
function inline(runs) {
  return (runs || []).map(r=>{
    let s=esc(r.text);
    if(r.i) s=`<emphasis>${s}</emphasis>`;
    if(r.b) s=`<strong>${s}</strong>`;
    if(r.link && /^(?:https?:|mailto:)/i.test(r.link)) s=`<a l:href="${esc(r.link)}">${s}</a>`;
    if(r.u) s=`<style name="underline">${s}</style>`;
    return s;
  }).join('');
}
const GENRE={fantasy:'sf_fantasy','dark-fantasy':'sf_fantasy',horror:'sf_horror','sci-fi':'sf',litrpg:'sf_fantasy',romance:'love_contemporary',historical:'prose_history',thriller:'thriller',cultivation:'adventure',regression:'sf_history'};
async function buildFb2({book,style,outPath,onProgress=()=>{}}) {
  const active=book.chapters.filter(c=>c.include && c.blocks.length);
  const resources=new Map(),warnings=[],sourceIds=new Map();
  function register(asset) {
    const hash=crypto.createHash('sha256').update(asset.data).digest('hex');
    if(resources.has(hash)) return resources.get(hash).id;
    const id='a'+String(resources.size+1).padStart(4,'0');
    resources.set(hash,{...asset,id});return id;
  }
  function asset(id) {
    if(sourceIds.has(id)) return sourceIds.get(id);
    const a=book.assets.get(id);
    if(!a) {warnings.push('Не найдена иллюстрация: '+id);return null;}
    const result=register(a);sourceIds.set(id,result);return result;
  }
  const cover=book.cover ? asset(book.cover.assetId) : null;
  function ornament(svg) {
    const data=new Resvg(svg,{fitTo:{mode:'width',value:1000},font:{loadSystemFonts:false}}).render().asPng();
    return register({data,mime:'image/png',ext:'png'});
  }
  const opener=style.signature ? ornament(svgTitleMark(style.accent,style.genre)) : null;
  const divider=style.signature && active.some(c=>c.blocks.some(b=>b.type==='sep')) ? ornament(svgSceneBreak(style.accent,style.genre)) : null;
  const img=id=>id?`<image l:href="#${id}"/>`:'';
  function block(b) {
    switch(b.type){
      case 'para': return `<p>${inline(b.runs)}</p>`;
      case 'heading': return `<subtitle>${inline(b.runs)}</subtitle>`;
      case 'image': return img(asset(b.assetId));
      case 'sep': return divider ? img(divider) : '<p>* * *</p>';
      case 'list': return b.items.map((runs,i)=>`<p>${b.ordered ? i+1+'.' : '•'} ${inline(runs)}</p>`).join('\n');
      case 'system': return '<cite>'+b.lines.map(runs=>`<p>${inline(runs)}</p>`).join('')+'</cite>';
      default: return '';
    }
  }
  const sections=active.map((c,i)=>{
    onProgress({phase:'fb2',label:'FB2: '+chapterLabel(c),done:i+1,total:active.length});
    return `<section id="ch${i+1}"><title><p>${esc(chapterLabel(c))}</p></title><empty-line/>${img(opener)}\n${c.blocks.map(block).join('\n')}</section>`;
  }).join('\n');
  const binaries=[...resources.values()].map(a=>`<binary id="${a.id}" content-type="${esc(a.mime)}">${a.data.toString('base64')}</binary>`).join('\n');
  const author=book.author || 'Автор не указан';
  const date=new Date().toISOString().slice(0,10);
  const xml=`<?xml version="1.0" encoding="UTF-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description><title-info><genre>${GENRE[style.genre] || 'sf_fantasy'}</genre><author><nickname>${esc(author)}</nickname></author><book-title>${esc(book.title)}</book-title>${cover?'<coverpage>'+img(cover)+'</coverpage>':''}<lang>${esc(book.language || 'ru')}</lang><translator><nickname>${esc(book.team)}</nickname></translator></title-info><document-info><author><nickname>${esc(book.team)}</nickname></author><program-used>PDFMaker Mobile</program-used><date value="${date}">${date}</date><id>${crypto.randomUUID()}</id><version>1.0</version></document-info></description>
<body>${sections}</body>
${binaries}
</FictionBook>`;
  const data=Buffer.from(xml,'utf8');await fs.writeFile(outPath,data);
  return {size:data.length,chapters:active.length,images:resources.size,warnings};
}
module.exports={buildFb2};

'use strict';
const fs=require('fs/promises');
const {XMLValidator}=require('fast-xml-parser');
const {parseFb2}=require('../import/fb2');
const {parseKindle}=require('../import/kindle');
const {runsText}=require('../model');
const {validateFb2}=require('./fb2-schema');
const norm=s=>String(s).replace(/\s+/g,' ').trim();
async function checkExport(file,{book,format}) {
  const data=await fs.readFile(file),checks=[{name:'Файл создан и не пуст',ok:data.length>0,detail:data.length+' байт'}];
  const active=book.chapters.filter(c=>c.include && c.blocks.length);
  let text;
  if(format==='txt') text=data.toString('utf8');
  else {
    if(format==='fb2') {
      checks.push({name:'FB2 содержит корректный XML',ok:XMLValidator.validate(data.toString('utf8'))===true});
      const validation=await validateFb2(data.toString('utf8'));
      checks.push({name:'FB2 соответствует официальной схеме формата',ok:validation.valid,detail:validation.errors.slice(0,3).map(e=>e.message).join('; ')});
    }
    else checks.push({name:'Контейнер Kindle BOOKMOBI',ok:data.toString('ascii',60,68)==='BOOKMOBI'});
    try{
      let imageId=0;const addAsset=()=>`qa${++imageId}`;
      const parsed=format==='fb2'?parseFb2(data,addAsset):await parseKindle(data,addAsset);
      text=parsed.sections.flatMap(s=>s.rawParas.map(p=>p.runs?runsText(p.runs):p.lines?p.lines.map(runsText).join(' '):'')).join(' ');
      checks.push({name:'Книга открывается после экспорта',ok:true});
    }catch(e){checks.push({name:'Книга открывается после экспорта',ok:false,detail:e.message});text='';}
  }
  const sourceText=norm(text);
  const probes=[active[0],active[Math.floor(active.length/2)],active.at(-1)].filter(Boolean).map(c=>{
    const b=c.blocks.find(b=>b.type==='para' && runsText(b.runs).trim());
    return b ? norm(runsText(b.runs)).slice(0,100) : '';
  }).filter(Boolean);
  checks.push({name:'Текст первой, средней и последней главы сохранён',ok:probes.every(p=>sourceText.includes(p)),detail:`Проверено фрагментов: ${probes.length}`});
  return {ok:checks.every(c=>c.ok),checks,notes:[]};
}
module.exports={checkExport};

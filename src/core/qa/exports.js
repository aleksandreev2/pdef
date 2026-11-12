'use strict';
const fs=require('fs/promises');
const {parseFb2Xml}=require('../import/fb2');
const {parseKindle}=require('../import/kindle');
const {chapterLabel,runsText}=require('../model');
const {validateFb2}=require('./fb2-schema');
const norm=s=>String(s).replace(/\s+/g,' ').trim();

function expectedFb2Paragraphs(chapter) {
  const paragraphs=[];
  for (const block of chapter.blocks) {
    if (block.type==='para' || block.type==='heading') paragraphs.push(runsText(block.runs));
    else if (block.type==='system') paragraphs.push(...block.lines.map(runsText));
    else if (block.type==='list') {
      paragraphs.push(...block.items.map((runs,i)=>`${block.ordered ? `${i+1}.` : '•'} ${runsText(runs)}`));
    }
  }
  return paragraphs.map(norm).filter(text=>text && text!=='* * *');
}

function compareFb2Sections(active,sections) {
  const changed=[];
  active.forEach((chapter,index)=>{
    const section=sections[index];
    if (!section || section.id!==`ch${index+1}` || norm(section.title)!==norm(chapterLabel(chapter))) {
      changed.push(chapterLabel(chapter));
      return;
    }
    const expected=expectedFb2Paragraphs(chapter);
    const headings=new Set(section.headingParas);
    const actual=section.rawParas.filter(p=>p.runs && !headings.has(p))
      .map(p=>norm(runsText(p.runs))).filter(text=>text && text!=='* * *');
    if (actual.length!==expected.length || actual.some((text,i)=>text!==expected[i])) changed.push(chapterLabel(chapter));
  });
  return {
    name:'Текст всех глав сохранён в исходном порядке',
    ok:sections.length===active.length && !changed.length,
    detail:changed.length ? changed.slice(0,3).join(', ') : `глав в файле: ${sections.length}, ожидалось: ${active.length}`,
  };
}

async function checkFb2(data,active,checks) {
  const xml=data.toString('utf8');
  const validation=await validateFb2(xml);
  checks.push({name:'FB2 соответствует официальной схеме формата',ok:validation.valid,
    detail:validation.errors.slice(0,3).map(e=>e.message).join('; ')});
  let imageId=0;
  let parsed;
  try {
    parsed=parseFb2Xml(xml,()=>`qa${++imageId}`);
  } catch (error) {
    checks.push({name:'FB2 открывается и содержит корректный XML',ok:false,detail:error.message});
    return {ok:false,checks,notes:[]};
  }
  checks.push({name:'FB2 открывается и содержит корректный XML',ok:true},compareFb2Sections(active,parsed.sections));
  return {ok:checks.every(c=>c.ok),checks,notes:parsed.warnings};
}

async function checkExport(file,{book,format}) {
  const data=await fs.readFile(file),checks=[{name:'Файл создан и не пуст',ok:data.length>0,detail:data.length+' байт'}];
  const active=book.chapters.filter(c=>c.include && c.blocks.length);
  if (format==='fb2') return checkFb2(data,active,checks);
  const notes=[];
  let text;
  if(format==='txt') text=data.toString('utf8');
  else {
    checks.push({name:'Контейнер Kindle BOOKMOBI',ok:data.toString('ascii',60,68)==='BOOKMOBI'});
    try{
      let imageId=0;const addAsset=()=>`qa${++imageId}`;
      const parsed=await parseKindle(data,addAsset);
      if (parsed.warnings) notes.push(...parsed.warnings);
      checks.push({name:'Книга открывается после экспорта',ok:true});
      text=parsed.sections.flatMap(s=>s.rawParas.map(p=>p.runs?runsText(p.runs):p.lines?p.lines.map(runsText).join(' '):'')).join(' ');
    }catch(e){checks.push({name:'Книга открывается после экспорта',ok:false,detail:e.message});text='';}
  }
  const sourceText=norm(text);
  const probes=[active[0],active[Math.floor(active.length/2)],active.at(-1)].filter(Boolean).map(c=>{
    const b=c.blocks.find(b=>b.type==='para' && runsText(b.runs).trim());
    return b ? norm(runsText(b.runs)).slice(0,100) : '';
  }).filter(Boolean);
  checks.push({name:'Текст первой, средней и последней главы сохранён',ok:probes.every(p=>sourceText.includes(p)),detail:`Проверено фрагментов: ${probes.length}`});
  return {ok:checks.every(c=>c.ok),checks,notes};
}
module.exports={checkExport};

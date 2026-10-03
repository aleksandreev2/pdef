'use strict';
const fs = require('fs/promises');
const { runsText, chapterLabel } = require('../model');

function chapterText(chapter) {
  const blocks = chapter.blocks.map(block => {
    switch(block.type) {
      case 'para': case 'heading': return runsText(block.runs);
      case 'system': return block.lines.map(runsText).join('\n');
      case 'list': return block.items.map((runs,i)=>`${block.ordered ? i+1+'.' : '•'} ${runsText(runs)}`).join('\n');
      case 'sep': return '* * *';
      default: return '';
    }
  }).filter(Boolean);
  return [chapterLabel(chapter),...blocks].join('\n\n');
}
async function buildTxt({book,outPath,onProgress=()=>{}}) {
  const active=book.chapters.filter(c=>c.include && c.blocks.length);
  onProgress({phase:'txt',label:'TXT: сохранение текста'});
  const text=[book.title,...active.map(chapterText)].join('\n\n\n')+'\n';
  const data=Buffer.from(text.replace(/\r?\n/g,'\r\n'),'utf8');
  await fs.writeFile(outPath,data);
  return {size:data.length,chapters:active.length,images:0,warnings:[]};
}
module.exports={buildTxt,chapterText};

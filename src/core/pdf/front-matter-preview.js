'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {makeBook}=require('../model');
const {clampStyle}=require('../style');
const {resolveFonts}=require('../fonts');
const {buildPdf}=require('./build');

async function previewFrontMatter({meta={},style={},stats=null}={}) {
  const book=makeBook();
  for(const key of ['title','subtitle','team','teamUrl']) {
    if(typeof meta[key]==='string') book[key]=meta[key];
  }
  book.title=book.title||'Название книги';
  book.stats={words:Number(stats?.words)||0,chapters:Number(stats?.chapters)||0};
  const normalized=clampStyle(style);
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pdfmaker-preview-'));
  try {
    const outPath=path.join(dir,'preview.pdf');
    await buildPdf({book,style:normalized,fonts:resolveFonts(normalized),outPath});
    return await fs.readFile(outPath);
  } finally {
    await fs.rm(dir,{recursive:true,force:true});
  }
}
module.exports={previewFrontMatter};

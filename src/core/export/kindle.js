'use strict';
const fs=require('fs/promises'),path=require('path'),os=require('os');
const {execFile}=require('child_process');
const {promisify}=require('util');
const run=promisify(execFile);
async function findConverter() {
  const exe=process.platform==='win32'?'ebook-convert.exe':'ebook-convert';
  const root=path.resolve(__dirname,'../../..');
  const candidates=[process.env.PDFMAKER_CALIBRE,
    path.join(root,'tools/calibre',exe),
    process.resourcesPath && path.join(process.resourcesPath,'calibre',exe),
    path.join(os.homedir(),'.pdfmaker/Calibre Portable/Calibre',exe),
    ...['ProgramFiles','ProgramFiles(x86)'].filter(k=>process.env[k]).map(k=>path.join(process.env[k],'Calibre2',exe)),
    ...(process.env.PATH || '').split(path.delimiter).filter(Boolean).map(dir=>path.join(dir.replace(/^"|"$/g,''),exe)),
    ...(process.platform==='darwin'?['/Applications/calibre.app/Contents/MacOS/ebook-convert']:[]),
    ...(process.platform==='linux'?['/opt/calibre/ebook-convert']:[])];
  for(const file of candidates.filter(Boolean)) try{if((await fs.stat(file)).isFile()) return path.resolve(file);}catch{}
  return null;
}
async function buildKindle({book,format,epubPath,outPath,converter,onProgress=()=>{}}) {
  if(!['mobi','azw3'].includes(format)) throw new Error('Неизвестный формат Kindle');
  converter ||= await findConverter();
  if(!converter) throw new Error('Для экспорта MOBI и AZW3 нужен Calibre. Установите его с calibre-ebook.com.');
  const parent=await fs.realpath(os.tmpdir()),temp=await fs.mkdtemp(path.join(parent,'pdfmaker-convert-'));
  try{
    onProgress({phase:format,label:format.toUpperCase()+': создание книги для Kindle'});
    const resultPath=path.join(temp,'book.'+format);
    const args=[epubPath,resultPath,'--output-profile','tablet','--chapter','/','--page-breaks-before','/','--no-inline-toc'];
    if(format==='mobi') args.push('--mobi-file-type','old');
    await run(converter,args,{windowsHide:true,timeout:600000,maxBuffer:8*1024*1024,
      env:{...process.env,CALIBRE_CONFIG_DIRECTORY:path.join(temp,'config'),CALIBRE_CACHE_DIRECTORY:path.join(temp,'cache'),CALIBRE_TEMP_DIR:temp,QT_QPA_PLATFORM:'offscreen'}});
    const stat=await fs.stat(resultPath);if(stat.size<100) throw new Error('Конвертер создал пустой файл');
    await fs.copyFile(resultPath,outPath);
    return {size:stat.size,chapters:book.chapters.filter(c=>c.include && c.blocks.length).length,images:book.stats?.images || 0,
      warnings:format==='mobi'?['MOBI использует упрощённое оформление для совместимости со старыми читалками.']:[]};
  } catch(e) {
    const detail=String(e.stderr || e.message || '').trim().slice(-1200);
    throw new Error(`Не удалось создать ${format.toUpperCase()}: ${detail}`);
  } finally {
    const real=await fs.realpath(temp);
    if(path.dirname(real).toLowerCase()===parent.toLowerCase() && path.basename(real).startsWith('pdfmaker-convert-')) await fs.rm(real,{recursive:true,force:true,maxRetries:3});
  }
}
module.exports={findConverter,buildKindle};

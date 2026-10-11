'use strict';
const fs=require('node:fs/promises');
const {createWriteStream}=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {Readable,Transform}=require('node:stream');
const {pipeline}=require('node:stream/promises');

function validInstaller(asset) {
  if(!asset || !/^PDFMaker-Mobile-\d+\.\d+\.\d+(?:\+[0-9A-Za-z.-]+)?-Setup\.exe$/.test(asset.name) ||
     !Number.isSafeInteger(asset.size) || asset.size<=0 || asset.size>900*1024*1024 || !/^sha256:[a-f0-9]{64}$/i.test(asset.digest)) return false;
  try {
    const url=new URL(asset.url),m=/^\/aleksandreev2\/pdef\/releases\/download\/([^/]+)\/([^/]+)$/.exec(url.pathname);
    if(url.protocol!=='https:' || url.hostname!=='github.com' || url.port || url.username || url.password || url.search || url.hash || !m) return false;
    const tag=decodeURIComponent(m[1]),name=decodeURIComponent(m[2]);
    return name===asset.name && /^v?\d+\.\d+\.\d+(?:\+[0-9A-Za-z.-]+)?$/i.test(tag) && name===`PDFMaker-Mobile-${tag.replace(/^v/i,'')}-Setup.exe`;
  } catch {return false;}
}
function selectInstaller(assets,version) {
  for(const item of Array.isArray(assets)?assets:[]) {
    const asset={name:item.name,size:item.size,digest:item.digest,url:item.browser_download_url};
    if(asset.name===`PDFMaker-Mobile-${version}-Setup.exe` && validInstaller(asset)) return asset;
  }
  return null;
}
async function downloadInstaller(asset,cacheDir,onProgress=()=>{},fetchImpl=globalThis.fetch) {
  if(!validInstaller(asset) || !path.isAbsolute(cacheDir)) throw new Error('В релизе нет проверенного Windows-установщика.');
  await fs.mkdir(cacheDir,{recursive:true});
  const root=await fs.realpath(cacheDir);
  const dir=await fs.mkdtemp(path.join(root,'update-'));
  const output=path.join(dir,asset.name),temporary=output+'.part';
  if(!output.startsWith(root+path.sep)) throw new Error('Недопустимая папка обновления.');
  try {
    let url=asset.url,response;
    const signal=AbortSignal.timeout(10*60*1000);
    for(let redirects=0;redirects<=5;redirects++) {
      response=await fetchImpl(url,{redirect:'manual',signal,headers:{'User-Agent':'PDFMaker-Mobile-updater',Accept:'application/octet-stream'}});
      if(![301,302,303,307,308].includes(response.status)) break;
      const next=new URL(response.headers.get('location'),url);
      if(next.protocol!=='https:' || next.username || next.password || next.port ||
         !['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com','github-releases.githubusercontent.com'].includes(next.hostname)) throw new Error('Недопустимая ссылка загрузки установщика.');
      await response.body?.cancel();url=next.href;
      if(redirects===5) throw new Error('Слишком много перенаправлений загрузки.');
    }
    if(!response.ok || !response.body) throw new Error('Не удалось скачать установщик. Попробуйте позже.');
    let received=0,lastPercent=-1;
    const hash=createHash('sha256');
    const meter=new Transform({transform(chunk,_encoding,done){
      received+=chunk.length;
      if(received>asset.size) {done(new Error('Размер установщика не соответствует релизу.'));return;}
      hash.update(chunk);
      const percent=Math.min(99,Math.floor(received/asset.size*100));
      if(percent!==lastPercent) {lastPercent=percent;onProgress({received,total:asset.size,percent});}
      done(null,chunk);
    }});
    await pipeline(Readable.fromWeb(response.body),meter,createWriteStream(temporary,{flags:'wx'}));
    if(received!==asset.size) throw new Error('Размер установщика не соответствует релизу.');
    if(hash.digest('hex')!==asset.digest.slice(7).toLowerCase()) throw new Error('Проверка целостности установщика не пройдена. Повторите загрузку.');
    await fs.rename(temporary,output);
    onProgress({received,total:asset.size,percent:100});
    return output;
  } catch(e) {await fs.rm(temporary,{force:true});throw e;}
}
async function installRelease({release,cacheDir,confirm,start,quit,onProgress,fetchImpl}) {
  if(!validInstaller(release?.installer)) throw new Error('В релизе нет проверенного Windows-установщика. Откройте страницу релиза.');
  if(!await confirm(release)) return {cancelled:true};
  const file=await downloadInstaller(release.installer,cacheDir,onProgress,fetchImpl);
  const error=await start(file);
  if(error) throw new Error('Не удалось запустить установщик: '+error);
  quit();
  return {started:true};
}
module.exports={validInstaller,selectInstaller,downloadInstaller,installRelease};

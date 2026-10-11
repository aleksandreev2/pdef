'use strict';
const {app,BrowserWindow,ipcMain}=require('electron');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs/promises');
const os=require('node:os');
const {createUpdateChecker}=require('../src/main/updates');
const {DEFAULT_STYLE,LIMITS}=require('../src/core/style');
const {GENRES}=require('../src/core/genres');
const {svgTitleMark,svgSceneBreak,svgFolio}=require('../src/core/signature');
const {availableFamilies,resolveFonts}=require('../src/core/fonts');
const pipeline=require('../src/core/pipeline');
const {installRelease}=require('../src/main/update-install');
app.disableHardwareAcceleration();app.on('window-all-closed',()=>{});
let win,dir,opened=null,confirmInstall=false,started=false,quitRequested=false;
const errors=[];
let tag='v3.4.0',offline=false;
const js=code=>win.webContents.executeJavaScript(code);
async function reload() {
  const loaded=new Promise(resolve=>win.webContents.once('did-finish-load',resolve));
  win.reload();await loaded;
}
async function wait(code) {
  const end=Date.now()+12000;
  do {if(await js(code))return;await new Promise(r=>setTimeout(r,100));}while(Date.now()<end);
  throw new Error('UI timeout: '+code);
}
app.whenReady().then(async()=>{
  const parent=await fs.realpath(os.tmpdir());dir=await fs.mkdtemp(path.join(parent,'pdfmaker-update-ui-'));
  const checker=createUpdateChecker({file:path.join(dir,'updates.json'),currentVersion:require('../package.json').version,fetchRelease:async()=>{
    if(offline)throw new Error('offline');
    return {tag_name:tag,html_url:'https://github.com/aleksandreev2/pdef/releases/tag/'+tag,draft:false,prerelease:false,
      assets:[{name:'PDFMaker-Mobile-3.4.0-Setup.exe',size:4,digest:'sha256:'+require('crypto').createHash('sha256').update('test').digest('hex'),browser_download_url:'https://github.com/aleksandreev2/pdef/releases/download/v3.4.0/PDFMaker-Mobile-3.4.0-Setup.exe'}]};
  }});
  ipcMain.handle('updates:status',()=>checker.status());
  ipcMain.handle('updates:check',(_e,manual)=>checker.check({manual:manual===true}));
  ipcMain.handle('updates:enabled',(_e,enabled)=>checker.setEnabled(enabled===true));
  ipcMain.handle('updates:dismiss',()=>checker.dismiss());
  ipcMain.handle('updates:open',async()=>{opened=(await checker.status()).release?.url;});
  ipcMain.handle('updates:install',async()=>installRelease({release:(await checker.status()).release,cacheDir:path.join(dir,'downloads'),confirm:async()=>confirmInstall,
    fetchImpl:async()=>new Response('test'),onProgress:p=>win.webContents.send('updates:progress',p),start:async file=>{assert.equal(await fs.readFile(file,'utf8'),'test');started=true;return '';},quit:()=>{quitRequested=true;}}));
  ipcMain.handle('output:getDirectory',()=>null);
  ipcMain.handle('book:previewFrontMatter',(_e,opts)=>require('../src/core/pdf/front-matter-preview').previewFrontMatter(opts));
  ipcMain.handle('book:analyze',(_e,paths)=>pipeline.analyze(paths));
  ipcMain.handle('asset:dataUrl',(_e,id)=>pipeline.assetDataUrl(id));
  ipcMain.handle('style:defaults',()=>({style:DEFAULT_STYLE,limits:LIMITS,families:availableFamilies(),warnings:resolveFonts({}).warnings,genres:GENRES.map(g=>({...g,opener:svgTitleMark(g.accent,g.id),divider:svgSceneBreak(g.accent,g.id),folio:svgFolio(g.accent,g.id)}))}));
  win=new BrowserWindow({show:false,width:1280,height:880,webPreferences:{preload:path.join(__dirname,'../src/main/preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:false,backgroundThrottling:false}});
  win.webContents.on('console-message',(_e,level,message)=>{if(level>=3)errors.push(message);});
  await win.loadFile(path.join(__dirname,'../src/renderer/index.html'));
  await wait('Boolean(window.__pdfmaker) && document.getElementById("styleGenre").options.length>0');
  assert.ok(await js('Boolean(document.getElementById("updateNotice"))'),'missing update notice');
  await wait('!document.getElementById("updateNotice").hidden');
  assert.match(await js('document.getElementById("updateNotice").textContent'),/3\.4\.0/);
  await js('document.getElementById("openUpdateRelease").click()');
  for(let i=0;i<30&&!opened;i++)await new Promise(r=>setTimeout(r,100));
  assert.equal(opened,'https://github.com/aleksandreev2/pdef/releases/tag/v3.4.0');
  assert.equal(await js('document.getElementById("installUpdateRelease").hidden'),false);
  await js('document.getElementById("installUpdateRelease").click()');
  await wait('!document.getElementById("installUpdateRelease").disabled');
  assert.equal(started,false);assert.equal(quitRequested,false);
  const si=process.argv.indexOf('--shots');
  if(si>=0){const out=path.resolve(process.argv[si+1]);await fs.mkdir(out,{recursive:true});await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))');await fs.writeFile(path.join(out,'update-notice.png'),(await win.webContents.capturePage()).toPNG());}
  await js('document.getElementById("dismissUpdateRelease").click()');
  await wait('document.getElementById("updateNotice").hidden');
  await reload();
  await wait('document.getElementById("updateCheckStatus").textContent.includes("3.4.0")');
  assert.equal(await js('document.getElementById("updateNotice").hidden'),true);
  await wait('!document.getElementById("checkUpdatesBtn").disabled');
  await js('document.getElementById("checkUpdatesBtn").click()');
  await wait('!document.getElementById("updateNotice").hidden');
  await js('document.getElementById("automaticUpdates").click()');
  await wait('document.getElementById("updateNotice").hidden');
  assert.equal((await checker.status()).enabled,false);
  await reload();
  await wait('document.getElementById("updateCheckStatus").textContent.includes("отключена")');
  assert.equal(await js('document.getElementById("automaticUpdates").checked'),false);
  offline=true;
  await wait('!document.getElementById("checkUpdatesBtn").disabled');
  await js('document.getElementById("checkUpdatesBtn").click()');
  await wait('document.getElementById("updateCheckStatus").textContent.includes("Не удалось")');
  // An offline update check must not disable source loading.
  const input=path.join(dir,'001.txt');await fs.writeFile(input,'Глава 1\n\nКнигу можно открыть без интернета.');
  await js(`window.__pdfmaker.addSources([${JSON.stringify(input)}])`);
  assert.equal(await js('window.__pdfmaker.state.chapters.length'),1);
  offline=false;confirmInstall=true;
  await js('document.getElementById("checkUpdatesBtn").click()');
  await wait('!document.getElementById("checkUpdatesBtn").disabled && !document.getElementById("updateNotice").hidden');
  await js('document.getElementById("installUpdateRelease").click()');
  await wait('document.getElementById("updateCheckStatus").textContent.includes("установщик")');
  assert.equal(started,true);assert.equal(quitRequested,true);
  assert.deepEqual(errors,[]);
  console.log('OK: startup notification, release action, persistent dismissal, manual check, disabled preference, offline loading, cancelled update and verified installer handoff.');
}).then(()=>finish(0)).catch(e=>{console.error(e);finish(1);});
async function finish(code){
  if(win&&!win.isDestroyed())win.destroy();
  if(dir){const real=await fs.realpath(dir);assert.equal(path.dirname(real).toLowerCase(),(await fs.realpath(os.tmpdir())).toLowerCase());assert.ok(path.basename(real).startsWith('pdfmaker-update-ui-'));await fs.rm(real,{recursive:true,force:true,maxRetries:3});}
  app.exit(code);
}

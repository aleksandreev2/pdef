'use strict';
// Real renderer + pipeline integration, with a hidden Electron window.
const {app,BrowserWindow,ipcMain}=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const pipeline=require('../src/core/pipeline');
const {DEFAULT_STYLE,LIMITS}=require('../src/core/style');
const {GENRES}=require('../src/core/genres');
const {svgTitleMark,svgSceneBreak,svgFolio}=require('../src/core/signature');
const {availableFamilies,resolveFonts}=require('../src/core/fonts');
app.disableHardwareAcceleration();
app.on('window-all-closed',()=>{}); // Keep the process alive until cleanup and app.exit(code).
let win,dir;
const errors=[];
const js=code=>win.webContents.executeJavaScript(code);
async function wait(code) {
  const end=Date.now()+15000;
  do { if(await js(code)) return; await new Promise(r=>setTimeout(r,100)); } while(Date.now()<end);
  throw new Error('UI condition timed out: '+code);
}
async function shot(name) {
  const i=process.argv.indexOf('--shots');
  if(i<0) return;
  const output=path.resolve(process.argv[i+1]);
  await fs.mkdir(output,{recursive:true});
  await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))');
  await fs.writeFile(path.join(output,name+'.png'),(await win.webContents.capturePage()).toPNG());
}
app.whenReady().then(async()=>{
  const parent=await fs.realpath(os.tmpdir());
  dir=await fs.mkdtemp(path.join(parent,'pdfmaker-audit-ui-'));
  const input=path.join(dir,'input');
  await fs.mkdir(input);
  await fs.writeFile(path.join(input,'001.txt'),'Глава 1\n\nПервый текст.');
  await fs.writeFile(path.join(input,'003.txt'),'Глава 3\n\nТретий текст.');
  await fs.writeFile(path.join(input,'004 & черновик.txt'),' \n');
  win=new BrowserWindow({width:1280,height:880,show:false,webPreferences:{preload:path.join(__dirname,'../src/main/preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:false,backgroundThrottling:false}});
  win.webContents.on('console-message',(_e,level,message)=>{if(level>=3) errors.push(message);});
  ipcMain.handle('book:analyze',(_e,paths)=>pipeline.analyze(paths));
  ipcMain.handle('book:applyEdits',(_e,edits)=>pipeline.applyEdits(edits));
  ipcMain.handle('book:build',(_e,opts)=>pipeline.build(opts));
  ipcMain.handle('book:previewFrontMatter',(_e,opts)=>require('../src/core/pdf/front-matter-preview').previewFrontMatter(opts));
  ipcMain.handle('asset:dataUrl',(_e,id)=>pipeline.assetDataUrl(id));
  ipcMain.handle('output:getDirectory',()=>null);
  const updateStatus={currentVersion:require('../package.json').version,enabled:false,status:'disabled',release:null,notify:false,checkedAt:0,message:''};
  ipcMain.handle('updates:status',()=>updateStatus);
  ipcMain.handle('updates:check',()=>updateStatus);
  ipcMain.handle('style:defaults',()=>({style:DEFAULT_STYLE,limits:LIMITS,families:availableFamilies(),warnings:resolveFonts({}).warnings,genres:GENRES.map(g=>({...g,opener:svgTitleMark(g.accent,g.id),divider:svgSceneBreak(g.accent,g.id),folio:svgFolio(g.accent,g.id)}))}));
  await win.loadFile(path.join(__dirname,'../src/renderer/index.html'));
  await wait('Boolean(window.__pdfmaker) && document.getElementById("styleGenre").options.length>0');
  await js(`window.__pdfmaker.addSources([${JSON.stringify(input)}])`);
  assert.ok(await js('Boolean(document.getElementById("sourceWarnings"))'),'visible source warning banner is missing');
  assert.equal(await js('document.getElementById("sourceWarnings").hidden'),false);
  const warning=await js('document.getElementById("sourceWarnings").textContent');
  assert.match(warning,/002/);assert.match(warning,/004 & черновик\.txt/);
  assert.equal(await js('document.querySelector("#chapterBody tr.off input[type=checkbox]").disabled'),true);
  await js('document.getElementById("showSourceAudit").click()');
  assert.equal(await js('document.querySelector(".panel.active").dataset.panel'),'audit');
  await js('window.__pdfmaker.switchTab("chapters")');
  await shot('1-warnings');
  await js(`document.getElementById('metaTitle').value='Проверка предупреждений';window.__pdfmaker.state.outDir=${JSON.stringify(path.join(dir,'out'))}; for(const key of ['pdf','epub','fb2','mobi','azw3']) document.getElementById('fmt'+key[0].toUpperCase()+key.slice(1)).checked=false;document.getElementById('fmtTxt').checked=true;void window.__pdfmaker.runBuild();`);
  await wait('document.getElementById("buildWarningsDialog").open');
  assert.equal(await js('window.__pdfmaker.state.report'),null);
  assert.equal(await fs.stat(path.join(dir,'out')).then(()=>true,()=>false),false);
  await shot('2-before-build');
  await js('document.getElementById("cancelWarningBuild").click()');
  await wait('!window.__pdfmaker.state.busy');
  assert.equal(await js('window.__pdfmaker.state.report'),null);
  await js('void window.__pdfmaker.runBuild()');
  await wait('document.getElementById("buildWarningsDialog").open');
  await js('document.getElementById("buildWarningsDialog").dispatchEvent(new Event("cancel",{cancelable:true}));document.getElementById("buildWarningsDialog").close();');
  await wait('!window.__pdfmaker.state.busy');
  assert.equal(await js('window.__pdfmaker.state.report'),null);
  await js('void window.__pdfmaker.runBuild()');
  await wait('document.getElementById("buildWarningsDialog").open');
  await js('document.getElementById("confirmWarningBuild").click()');
  await wait('Boolean(window.__pdfmaker.state.report) && !window.__pdfmaker.state.busy');
  const report=await js('document.getElementById("reportContent").textContent');
  assert.match(report,/002/);assert.match(report,/004 & черновик\.txt/);
  const exported=await js('window.__pdfmaker.state.report.txt.path');
  assert.match(await fs.readFile(exported,'utf8'),/Третий текст/);
  console.log('OK: warning banner, audit navigation, empty row, review cancellation, confirmed export and final warning report.');
  // Repair the missing chapter and verify the warning disappears after reload.
  await fs.writeFile(path.join(input,'002.txt'),'Глава 2\n\nВторой текст.');
  await fs.writeFile(path.join(input,'004 & черновик.txt'),'Глава 4\n\nЧетвёртый текст.');
  await js('document.getElementById("clearBtn").click()');
  assert.equal(await js('document.getElementById("sourceWarnings").hidden'),true);
  await js(`window.__pdfmaker.addSources([${JSON.stringify(input)}])`);
  assert.equal(await js('document.getElementById("sourceWarnings").hidden'),true);
  // Click exclude and build immediately, before the edit debounce can finish.
  await js(`const row=document.querySelector('#chapterBody tr[data-id="'+window.__pdfmaker.state.chapters.find(c=>c.number===2).id+'"]');row.querySelector('input[type=checkbox]').click();void window.__pdfmaker.runBuild();`);
  await wait('document.getElementById("buildWarningsDialog").open');
  assert.match(await js('document.getElementById("buildWarningsList").textContent'),/002/);
  await js('document.getElementById("cancelWarningBuild").click()');
  await wait('!window.__pdfmaker.state.busy');
  await js('document.getElementById("includeAllBtn").click()');
  await wait('window.__pdfmaker.state.audit.gaps.length===0');
  assert.equal(await js('document.getElementById("sourceWarnings").hidden'),true);
  await js('void window.__pdfmaker.runBuild()');
  await wait('!window.__pdfmaker.state.busy && window.__pdfmaker.state.report.stats.chapters===4');
  assert.equal(await js('document.getElementById("buildWarningsDialog").open'),false);
  console.log('OK: repaired files clear warnings, immediate build uses current selection, clean book needs no confirmation.');
  assert.deepEqual(errors,[],'renderer errors');
}).then(()=>finish(0)).catch(e=>{console.error(e);finish(1);});
async function finish(code) {
  if(win&&!win.isDestroyed()) win.destroy();
  if(dir) {
    const real=await fs.realpath(dir);
    const parent=await fs.realpath(os.tmpdir());
    assert.equal(path.dirname(real).toLowerCase(),parent.toLowerCase());
    assert.ok(path.basename(real).startsWith('pdfmaker-audit-ui-'));
    await fs.rm(real,{recursive:true,force:true,maxRetries:3});
  }
  app.exit(code);
}

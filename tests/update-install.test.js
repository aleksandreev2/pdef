'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {createHash}=require('node:crypto');
const bytes=Buffer.from('controlled installer fixture');
const digest='sha256:'+createHash('sha256').update(bytes).digest('hex');
const installer={name:'PDFMaker-Mobile-3.4.0-Setup.exe',size:bytes.length,digest,url:'https://github.com/aleksandreev2/pdef/releases/download/v3.4.0/PDFMaker-Mobile-3.4.0-Setup.exe'};
async function fixture(t){
  const parent=await fs.realpath(os.tmpdir()),dir=await fs.mkdtemp(path.join(parent,'pdfmaker-installer-test-'));
  t.after(async()=>{assert.equal(path.dirname(await fs.realpath(dir)).toLowerCase(),parent.toLowerCase());await fs.rm(dir,{recursive:true,force:true});});
  return dir;
}
test('installer download verifies the exact size and digest and reports completed progress',async t=>{
  const {downloadInstaller}=require('../src/main/update-install');
  const dir=await fixture(t),progress=[];
  const output=await downloadInstaller(installer,dir,p=>progress.push(p),async(url,options)=>{
    assert.equal(url,installer.url);assert.equal(options.redirect,'manual');
    return new Response(bytes,{status:200});
  });
  assert.deepEqual(await fs.readFile(output),bytes);
  assert.equal(path.dirname(output).startsWith(dir+path.sep),true);
  assert.equal(path.basename(output),installer.name);
  assert.equal(progress.at(-1).percent,100);
});
test('a damaged or truncated installer is removed and never returned for execution',async t=>{
  const {downloadInstaller}=require('../src/main/update-install');
  const dir=await fixture(t);
  for(const data of [Buffer.alloc(bytes.length,1),bytes.subarray(0,3),Buffer.concat([bytes,bytes])]) {
    await assert.rejects(downloadInstaller(installer,dir,()=>{},async()=>new Response(data,{status:200})),/целост|размер/i);
  }
  const dirs=await fs.readdir(dir);for(const d of dirs)assert.deepEqual(await fs.readdir(path.join(dir,d)),[]);
});
test('download follows only trusted GitHub asset redirects and does not request an arbitrary host',async t=>{
  const {downloadInstaller}=require('../src/main/update-install');
  const dir=await fixture(t);let calls=0;
  await assert.rejects(downloadInstaller(installer,dir,()=>{},async()=>{calls++;return new Response(null,{status:302,headers:{Location:'https://evil.example/install.exe'}});}),/ссылк|адрес/i);
  assert.equal(calls,1);
  const output=await downloadInstaller(installer,dir,()=>{},async(url)=>url===installer.url ?
    new Response(null,{status:302,headers:{Location:'https://release-assets.githubusercontent.com/download.exe'}}) : new Response(bytes,{status:200}));
  assert.deepEqual(await fs.readFile(output),bytes);
});
test('unsafe filenames, missing checksums and unrelated asset URLs are rejected before network access',async t=>{
  const {downloadInstaller}=require('../src/main/update-install');
  const dir=await fixture(t);let calls=0;
  for(const patch of [{name:'../test.exe'},{digest:null},{url:'https://github.com/other/repo/releases/download/v3.4.0/test.exe'},{size:9999999999}])
    await assert.rejects(downloadInstaller({...installer,...patch},dir,()=>{},async()=>{calls++;return new Response(bytes);}),/установщик/i);
  assert.equal(calls,0);
});

test('cancelled update downloads nothing; successful update starts only a verified installer before quitting',async t=>{
  const {installRelease}=require('../src/main/update-install');
  const dir=await fixture(t);let fetched=0;
  const actions=[];
  const options={release:{version:'3.4.0',installer},cacheDir:dir,
    confirm:async()=>false,fetchImpl:async()=>{fetched++;return new Response(bytes);},
    start:async file=>{assert.deepEqual(await fs.readFile(file),bytes);actions.push('start');return '';},quit:()=>actions.push('quit')};
  assert.deepEqual(await installRelease(options),{cancelled:true});
  assert.equal(fetched,0);assert.deepEqual(actions,[]);
  assert.deepEqual(await installRelease({...options,confirm:async()=>true}),{started:true});
  assert.deepEqual(actions,['start','quit']);
  actions.length=0;
  await assert.rejects(installRelease({...options,confirm:async()=>true,fetchImpl:async()=>new Response(Buffer.alloc(bytes.length))}),/целост/i);
  assert.deepEqual(actions,[]);
});

'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');

const release=tag=>({tag_name:tag,name:'Новая версия',html_url:'https://github.com/aleksandreev2/pdef/releases/tag/'+tag,draft:false,prerelease:false});
async function fixture(t,fetchRelease) {
  const parent=await fs.realpath(os.tmpdir());
  const dir=await fs.mkdtemp(path.join(parent,'pdfmaker-updates-test-'));
  t.after(async()=>{
    assert.equal(path.dirname(await fs.realpath(dir)).toLowerCase(),parent.toLowerCase());
    await fs.rm(dir,{recursive:true,force:true});
  });
  const {createUpdateChecker}=require('../src/main/updates');
  let now=1000000000000;
  const options={file:path.join(dir,'updates.json'),currentVersion:'3.1.0',fetchRelease,now:()=>now};
  return {make:()=>createUpdateChecker(options),advance:ms=>{now+=ms;},file:options.file};
}

test('numeric versions detect newer stable releases and ignore older, equal and beta versions',async t=>{
  let value=release('v3.10.0');
  const f=await fixture(t,async()=>value);
  const checker=f.make();
  const available=await checker.check({manual:true});
  assert.equal(available.status,'available');assert.equal(available.notify,true);
  assert.equal(available.release.version,'3.10.0');
  assert.equal(available.release.url,'https://github.com/aleksandreev2/pdef/releases/tag/v3.10.0');
  value=release('v3.2.0+build.1');
  assert.equal((await checker.check({manual:true})).status,'available');
  for(const tag of ['3.1.0','v3.0.9','v3.2.0-beta.1','banana']) {
    value=release(tag);
    assert.notEqual((await checker.check({manual:true})).status,'available',tag);
  }
  for(const flags of [{draft:true},{prerelease:true}]) {
    value={...release('v4.0.0'),...flags};
    assert.notEqual((await checker.check({manual:true})).status,'available');
  }
});

test('startup uses the cache, dismissal persists, and the next release notifies again',async t=>{
  let calls=0,value=release('v3.2.0');
  const f=await fixture(t,async()=>{calls++;return value;});
  let checker=f.make();
  assert.equal((await checker.check()).notify,true);
  await checker.dismiss();
  checker=f.make();
  assert.equal((await checker.check()).notify,false);
  assert.equal(calls,1);
  assert.equal((await checker.check({manual:true})).notify,true);
  value=release('v3.3.0');f.advance(6*60*60*1000+1);
  const newer=await checker.check();
  assert.equal(newer.notify,true);assert.equal(newer.release.version,'3.3.0');
});

test('disabled automatic checks make no network request and the setting survives restart',async t=>{
  let calls=0;
  const f=await fixture(t,async()=>{calls++;return release('v3.2.0');});
  await f.make().setEnabled(false);
  const checker=f.make();
  assert.equal((await checker.check()).status,'disabled');assert.equal(calls,0);
  assert.equal((await checker.check({manual:true})).status,'available');assert.equal(calls,1);
  assert.equal((await checker.check()).status,'disabled');
});

test('network failure leaves the book alone, retries later and preserves a known update',async t=>{
  let broken=false,calls=0;
  const f=await fixture(t,async()=>{calls++;if(broken)throw new Error('offline');return release('v3.2.0');});
  const checker=f.make();
  await checker.check();broken=true;
  const failed=await checker.check({manual:true});
  assert.equal(failed.status,'unavailable');assert.equal(failed.release.version,'3.2.0');
  assert.equal((await checker.check()).release.version,'3.2.0');assert.equal(calls,2);
  broken=false;f.advance(10*60*1000+1);
  assert.equal((await checker.check()).status,'available');assert.equal(calls,3);
});

test('concurrent checks share a request and rate limits prevent immediate manual retries',async t=>{
  let calls=0;
  const f=await fixture(t,async()=>{calls++;await new Promise(r=>setTimeout(r,15));const e=new Error('limited');e.retryAfterMs=3600000;throw e;});
  const checker=f.make();
  const result=await Promise.all([checker.check(),checker.check({manual:true})]);
  assert.equal(calls,1);assert.ok(result.every(r=>r.status==='unavailable'));
  await checker.check({manual:true});assert.equal(calls,1);
  f.advance(3600001);await checker.check({manual:true});assert.equal(calls,2);
});

test('release and cached links cannot point outside the configured GitHub repository',async t=>{
  const f=await fixture(t,async()=>({...release('v3.2.0'),html_url:'https://evil.example/download'}));
  const checker=f.make();
  const result=await checker.check({manual:true});
  assert.notEqual(result.status,'available');assert.equal(result.release,null);
  await fs.writeFile(f.file,JSON.stringify({enabled:true,nextCheckAt:2000000000000,release:{version:'99.0.0',url:'file:///C:/test.exe'}}));
  assert.equal((await f.make().check()).release,null);
  await fs.writeFile(f.file,'{broken');
  assert.equal((await f.make().check()).release,null);
});

test('GitHub transport uses the public latest-release endpoint with a timeout and rejects HTTP errors',async()=>{
  const {fetchLatestRelease}=require('../src/main/updates');
  let observed;
  const value=await fetchLatestRelease('3.1.0',async(url,options)=>{
    observed={url,options};return new Response(JSON.stringify(release('v3.2.0')),{status:200});
  });
  assert.equal(value.tag_name,'v3.2.0');
  assert.equal(observed.url,'https://api.github.com/repos/aleksandreev2/pdef/releases/latest');
  assert.equal(observed.options.headers.Authorization,undefined);
  assert.equal(observed.options.redirect,'error');assert.ok(observed.options.signal instanceof AbortSignal);
  await assert.rejects(fetchLatestRelease('3.1.0',async()=>new Response('',{status:404})),/релиз/i);
  await assert.rejects(fetchLatestRelease('3.1.0',async()=>new Response('',{status:403,headers:{'Retry-After':'120'}})),e=>e.retryAfterMs===120000);
});

test('only a matching installer with a checksum is offered, including after a cache reload',async t=>{
  const asset={name:'PDFMaker-Mobile-3.2.0-Setup.exe',size:100,digest:'sha256:'+'a'.repeat(64),browser_download_url:'https://github.com/aleksandreev2/pdef/releases/download/v3.2.0/PDFMaker-Mobile-3.2.0-Setup.exe'};
  let value={...release('v3.2.0'),assets:[asset]};
  const f=await fixture(t,async()=>value);
  assert.equal((await f.make().check()).release.installer.name,asset.name);
  assert.equal((await f.make().check()).release.installer.digest,asset.digest);
  value={...value,assets:[{...asset,digest:null}]};
  assert.equal((await f.make().check({manual:true})).release.installer,null);
});

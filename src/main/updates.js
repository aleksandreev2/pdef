'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {selectInstaller}=require('./update-install');
const REPOSITORY='aleksandreev2/pdef';
const CHECK_INTERVAL=6*60*60*1000;

function versionParts(value) {
  const m=/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z.-]+)?$/i.exec(String(value));
  return m ? m.slice(1,4).map(BigInt) : null;
}
function isNewer(candidate,current) {
  const a=versionParts(candidate),b=versionParts(current);
  if(!a||!b) return false;
  for(let i=0;i<3;i++) if(a[i]!==b[i]) return a[i]>b[i];
  return false;
}
function normalizeRelease(value,current) {
  if(!value || value.draft || value.prerelease || !isNewer(value.tag_name,current)) return null;
  let url;
  try {url=new URL(value.html_url);} catch {return null;}
  const prefix='/'+REPOSITORY+'/releases/tag/';
  if(url.protocol!=='https:' || url.hostname!=='github.com' || url.port || url.username || url.password || url.search || url.hash ||
     !url.pathname.startsWith(prefix)) return null;
  try {if(decodeURIComponent(url.pathname.slice(prefix.length))!==value.tag_name) return null;} catch {return null;}
  const version=value.tag_name.replace(/^v/i,'');
  return {version,tag:value.tag_name,url:url.href,installer:selectInstaller(value.assets,version)};
}

async function fetchLatestRelease(currentVersion,fetchImpl=globalThis.fetch) {
  const response=await fetchImpl(`https://api.github.com/repos/${REPOSITORY}/releases/latest`,{
    headers:{Accept:'application/vnd.github+json','User-Agent':`PDFMaker-Mobile/${currentVersion}`},
    redirect:'error',signal:AbortSignal.timeout(8000),
  });
  if(response.status===403 || response.status===429) {
    const e=new Error('GitHub временно ограничил проверки. Попробуйте позже.');
    const seconds=Number(response.headers.get('retry-after'));
    const reset=Number(response.headers.get('x-ratelimit-reset'))*1000-Date.now();
    e.retryAfterMs=Math.min(24*60*60*1000,Math.max(60000,seconds>0 ? seconds*1000 : reset>0 ? reset : 10*60*1000));
    throw e;
  }
  if(response.status===404) throw new Error('Опубликованный релиз не найден или репозиторий недоступен.');
  if(!response.ok) throw new Error('Не удалось проверить GitHub. Попробуйте позже.');
  const body=await response.text();
  if(body.length>1024*1024) throw new Error('Ответ GitHub слишком большой.');
  return JSON.parse(body);
}

function createUpdateChecker({file,currentVersion,fetchRelease=()=>fetchLatestRelease(currentVersion),now=Date.now}) {
  let loaded,pending,writes=Promise.resolve();
  async function state() {
    if(!loaded) loaded=(async()=>{
      let raw={};
      try {raw=JSON.parse(await fs.readFile(file,'utf8'));} catch(e) {if(e.code!=='ENOENT' && !(e instanceof SyntaxError)) throw e;}
      if(!raw || typeof raw!=='object' || Array.isArray(raw)) raw={};
      const cached=raw.release?.installer;
      const release=normalizeRelease({tag_name:raw.release?.tag || raw.release?.version,html_url:raw.release?.url,
        assets:cached?[{...cached,browser_download_url:cached.url}]:[]},currentVersion);
      const timestamp=v=>Number.isFinite(v)&&v>=0 ? v : 0;
      return {
        enabled:raw.enabled!==false,
        checkedAt:timestamp(raw.checkedAt),
        nextCheckAt:raw.release && !release ? 0 : Math.min(timestamp(raw.nextCheckAt),now()+CHECK_INTERVAL),
        blockedUntil:Math.min(timestamp(raw.blockedUntil),now()+24*60*60*1000),
        release,dismissed:typeof raw.dismissed==='string' ? raw.dismissed : null,
        status:['available','current','unavailable'].includes(raw.status) ? raw.status : 'unknown',
        message:raw.status==='unavailable' ? 'Не удалось проверить обновления. Попробуйте позже.' : '',
      };
    })();
    return loaded;
  }
  function snapshot(s,manual=false) {
    return {currentVersion,enabled:s.enabled,status:s.status,checkedAt:s.checkedAt,release:s.release,
      notify:!!s.release && (manual || s.dismissed!==s.release.version),message:s.message};
  }
  async function save(s) {
    writes=writes.catch(()=>{}).then(async()=>{
      await fs.mkdir(path.dirname(file),{recursive:true});
      const temporary=`${file}.${randomUUID()}.tmp`;
      try {await fs.writeFile(temporary,JSON.stringify(s,null,2),'utf8');await fs.rename(temporary,file);}
      finally {await fs.rm(temporary,{force:true});}
    });
    return writes;
  }
  return {
    async status() {return snapshot(await state());},
    async setEnabled(enabled) {const s=await state();s.enabled=!!enabled;await save(s);return snapshot(s);},
    async dismiss() {const s=await state();if(s.release) s.dismissed=s.release.version;await save(s);return snapshot(s);},
    async check({manual=false}={}) {
      const s=await state();
      if(!manual && !s.enabled) return {...snapshot(s),status:'disabled',notify:false};
      if(s.blockedUntil>now() || (!manual && s.nextCheckAt>now())) return snapshot(s,manual);
      if(!pending) pending=(async()=>{
        try {
          const raw=await fetchRelease();
          if(!raw || !versionParts(raw.tag_name) || raw.draft || raw.prerelease) throw new Error('В релизе GitHub не указана корректная стабильная версия.');
          const release=normalizeRelease(raw,currentVersion);
          if(isNewer(raw.tag_name,currentVersion)&&!release) throw new Error('В релизе GitHub указана недопустимая ссылка.');
          s.release=release;s.status=release?'available':'current';s.message='';
          s.checkedAt=now();s.nextCheckAt=now()+CHECK_INTERVAL;s.blockedUntil=0;
        } catch(e) {
          s.status='unavailable';s.message=e.retryAfterMs ? 'GitHub временно ограничил проверки. Попробуйте позже.' :
            'Не удалось проверить обновления. Проверьте соединение и попробуйте позже.';
          s.nextCheckAt=now()+10*60*1000;
          if(e.retryAfterMs) {s.blockedUntil=now()+Math.min(24*60*60*1000,Math.max(60000,e.retryAfterMs));s.nextCheckAt=s.blockedUntil;}
        }
        await save(s);
      })().finally(()=>{pending=null;});
      await pending;
      return snapshot(s,manual);
    },
  };
}
module.exports={createUpdateChecker,fetchLatestRelease,CHECK_INTERVAL};

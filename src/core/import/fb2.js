'use strict';
const { XMLParser, XMLValidator } = require('fast-xml-parser');
const iconv = require('iconv-lite');
const { makeRun, runsText, KIND } = require('../model');
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', preserveOrder: true, trimValues: false, parseTagValue: false, processEntities: true, ignoreDeclaration: true, ignorePiTags: true });
const key = n => Object.keys(n).find(k => k !== ':@') || '';
const tag = n => key(n).split(':').pop();
const kids = n => Array.isArray(n[key(n)]) ? n[key(n)] : [];
const attrs = n => n[':@'] || {};
const attr = (n,name) => Object.entries(attrs(n)).find(([k])=>k.replace(/^@/,'').split(':').pop()===name)?.[1];
function find(n,name) { return kids(n).find(c=>tag(c)===name); }
function text(n) { return tag(n)==='#text' ? String(n['#text']) : kids(n).map(text).join(''); }
function inline(n, fmt = {}) {
  const name = tag(n);
  if (name === '#text') return [makeRun(String(n['#text']), fmt)];
  const next = { ...fmt };
  if (name === 'strong') next.b = true;
  if (name === 'emphasis') next.i = true;
  if (name === 'a' && /^(https?:|mailto:)/i.test(attr(n,'href') || '')) next.link = attr(n,'href');
  return kids(n).flatMap(c=>inline(c,next));
}
function parseFb2(buffer, addAsset) {
  let encoding = buffer.subarray(0,300).toString('ascii').match(/encoding\s*=\s*["']([^"']+)/i)?.[1];
  if ((buffer[0]===0xff && buffer[1]===0xfe) || (buffer[0]===60 && buffer[1]===0)) encoding='utf16le';
  else if ((buffer[0]===0xfe && buffer[1]===0xff) || (buffer[0]===0 && buffer[1]===60)) encoding='utf16be';
  else encoding ||= 'utf8';
  // XML defaults to UTF-8; the language heuristic belongs only to TXT.
  if (!iconv.encodingExists(encoding)) throw new Error('Неизвестная кодировка FB2: '+encoding);
  const xml = iconv.decode(buffer,encoding).replace(/^\ufeff/, '');
  const valid = XMLValidator.validate(xml);
  if (valid !== true) throw new Error('Повреждённый XML FB2: '+valid.err.msg);
  const root = parser.parse(xml).find(n=>tag(n)==='FictionBook');
  if (!root) throw new Error('Не найден корневой элемент FictionBook');
  const binaries = new Map(kids(root).filter(n=>tag(n)==='binary').map(n=>[attr(n,'id'),n]));
  const cache = new Map(), warnings = [];
  const image = href => {
    const id = String(href || '').replace(/^#/,'');
    if (cache.has(id)) return cache.get(id);
    const binary = binaries.get(id); if (!binary) { warnings.push('Не найдено изображение FB2: '+id); return null; }
    const mime = String(attr(binary,'content-type') || '').toLowerCase();
    const ext = ({'image/jpeg':'jpg','image/png':'png','image/gif':'gif','image/webp':'webp','image/bmp':'bmp'})[mime];
    if (!ext) { warnings.push('Не поддержан тип изображения FB2: '+mime); return null; }
    const data = Buffer.from(text(binary).replace(/\s+/g,''),'base64');
    if (!data.length) { warnings.push('Пустое изображение FB2: '+id); return null; }
    const assetId = addAsset(data,ext,mime); cache.set(id,assetId); return assetId;
  };
  const info = find(find(root,'description') || {},'title-info');
  const title = info ? text(find(info,'book-title') || {}).trim() : '';
  const author = info ? kids(info).filter(n=>tag(n)==='author').map(n=>{
    const full=['first-name','middle-name','last-name'].map(k=>text(find(n,k) || {}).trim()).filter(Boolean).join(' ');
    return full || text(find(n,'nickname') || {}).trim();
  }).filter(Boolean).join('; ') : '';
  const language = info ? text(find(info,'lang') || {}).trim() : '';
  const coverNode = info && find(find(info,'coverpage') || {},'image');
  const coverAssetId = coverNode ? image(attr(coverNode,'href')) : null;
  function paragraphs(n, style) {
    const name = tag(n);
    if (name === 'image') { const assetId = image(attr(n,'href')); return assetId ? [{image:{assetId,alt:attr(n,'title') || ''}}] : []; }
    if (name === 'empty-line') return [];
    if (name === 'title') return kids(n).flatMap(c=>paragraphs(c,'Heading1'));
    if (name === 'p' || name === 'v' || name === 'subtitle' || name === 'text-author') {
      const out = []; let runs = [];
      const flush = () => { if(runsText(runs).trim()) out.push({runs, ...(style ? {style} : {}), ...(name === 'subtitle' ? {style:'Heading3'} : {})}); runs=[]; };
      const visit = (node,fmt) => {
        if (tag(node)==='image') { flush(); out.push(...paragraphs(node)); return; }
        if (tag(node)==='#text') { runs.push(...inline(node,fmt)); return; }
        const next={...fmt};
        if(tag(node)==='strong') next.b=true;
        if(tag(node)==='emphasis') next.i=true;
        if(tag(node)==='a' && /^(https?:|mailto:)/i.test(attr(node,'href') || '')) next.link=attr(node,'href');
        for(const child of kids(node)) visit(child,next);
      };
      visit(n,style?{b:true}:{}); flush(); return out;
    }
    if (name === 'table') {
      const lines = kids(n).filter(c=>tag(c)==='tr').map(row=>[makeRun(kids(row).map(text).join('  ·  '))]);
      return lines.length ? [{table:true,lines}] : [];
    }
    if (name === '#text') return text(n).trim() ? [{runs:[makeRun(text(n))]}] : [];
    return kids(n).flatMap(c=>paragraphs(c,style));
  }
  const sections = [];
  function section(n, fallbackTitle, kind) {
    const ownTitle = find(n,'title');
    const label = ownTitle ? kids(ownTitle).map(text).join(' ').trim() : fallbackTitle;
    let raw = [], hadChild = false, lastChild = null;
    for (const child of kids(n)) {
      if (tag(child) === 'section') {
        if (hadChild && lastChild) { lastChild.rawParas.push(...raw); raw = []; }
        if (raw.some(p=>p.image || p.table || (p.runs && p.style!=='Heading1'))) { sections.push({ title: label, kind, rawParas: raw }); raw = []; }
        const headingOnly = raw; raw = [];
        const before = sections.length;
        section(child,'',kind);
        if (headingOnly.length && sections[before]) {
          const target = sections[before].rawParas;
          const at = target.findIndex(p=>p.style!=='Heading1');
          target.splice(at<0?target.length:at,0,...headingOnly.map(p=>({...p,style:'Heading3'})));
        }
        lastChild = sections.at(-1); hadChild = true;
      } else raw.push(...paragraphs(child));
    }
    if (hadChild && lastChild) lastChild.rawParas.push(...raw);
    else if (raw.length) sections.push({ title: label, kind, rawParas: raw });
  }
  for (const body of kids(root).filter(n=>tag(n)==='body')) section(body,title,attr(body,'name')==='notes' ? KIND.EXTRA : undefined);
  if (!sections.length) throw new Error('В FB2 не найдено содержимое книги');
  return { sections, title, author, language, coverAssetId, encoding, warnings: [...new Set(warnings)] };
}
module.exports = { parseFb2 };

'use strict';
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { parseHtml, splitHtmlSections } = require('./html');

function inspectKindle(buffer) {
  if (buffer.length<86 || buffer.toString('ascii',60,68)!=='BOOKMOBI') throw new Error('Файл не является книгой MOBI/AZW3');
  const count = buffer.readUInt16BE(76);
  if (!count || 78+count*8>buffer.length) throw new Error('Повреждена таблица записей Kindle');
  const offsets = Array.from({length:count},(_,i)=>buffer.readUInt32BE(78+i*8));
  if (offsets.some((v,i)=>v<78+count*8 || v>=buffer.length || (i && v<offsets[i-1]))) throw new Error('Повреждены смещения записей Kindle');
  const record = index => buffer.subarray(offsets[index],offsets[index+1] ?? buffer.length);
  const header = index => {
    const r = record(index);
    if (r.length<132 || r.toString('ascii',16,20)!=='MOBI') throw new Error('Не найден заголовок MOBI');
    if (r.readUInt16BE(12)!==0) throw new Error('Книга защищена DRM: импорт зашифрованного текста не поддерживается');
    const length = r.readUInt32BE(20);
    if (length<116 || length+16>r.length) throw new Error('Повреждён заголовок MOBI');
    const exth = new Map();
    if (r.readUInt32BE(128)&64) {
      let at = length+16;
      if (at+12>r.length || r.toString('ascii',at,at+4)!=='EXTH') throw new Error('Повреждён EXTH');
      const end = at+r.readUInt32BE(at+4), n = r.readUInt32BE(at+8); at+=12;
      if (end>r.length || n>(end-at)/8) throw new Error('Повреждён EXTH');
      for (let i=0;i<n;i++) { if(at+8>end) throw new Error('Повреждён EXTH'); const type=r.readUInt32BE(at), size=r.readUInt32BE(at+4); if(size<8 || at+size>end) throw new Error('Повреждён EXTH'); exth.set(type,r.subarray(at+8,at+size)); at+=size; }
    }
    return {r,index,length,exth,version:r.readUInt32BE(36)};
  };
  let h = header(0);
  const boundary = h.exth.get(121);
  if (h.version<8 && boundary?.length===4 && boundary.readUInt32BE(0)<count) h = header(boundary.readUInt32BE(0));
  return {offsets,record,header:h,kf8:h.version>=8};
}
function withExth(buffer, info) {
  const h = info.header;
  if (h.exth.size || (h.r.readUInt32BE(128)&64)) return buffer;
  // The upstream reader expects EXTH even in old books without metadata.
  const at = info.offsets[h.index]+h.length+16;
  const empty = Buffer.alloc(12); empty.write('EXTH'); empty.writeUInt32BE(12,4);
  const result = Buffer.concat([buffer.subarray(0,at),empty,buffer.subarray(at)]);
  const start = info.offsets[h.index]; result.writeUInt32BE(h.r.readUInt32BE(128)|64,start+128);
  const title = h.r.readUInt32BE(84); if(title>=h.length+16) result.writeUInt32BE(title+12,start+84);
  info.offsets.forEach((offset,i)=>{ if(offset>=at) result.writeUInt32BE(offset+12,78+i*8); });
  return result;
}
async function parseKindle(buffer, addAsset) {
  const info = inspectKindle(buffer);
  const {initMobiFile,initKf8File} = await import('@lingo-reader/mobi-parser');
  const parent = await fs.realpath(os.tmpdir());
  const temp = await fs.mkdtemp(path.join(parent,'pdfmaker-kindle-'));
  const warnings = [], images = new Map(); let book;
  const readImage = async file => {
    try { return await fs.readFile(file); }
    catch(e) { if(['ENOENT','EISDIR','EACCES'].includes(e.code)) return null; throw e; }
  };
  const image = async (filename, depth = 0) => {
    const file = path.resolve(filename || '');
    const relative = path.relative(temp,file);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
    if (images.has(file)) return images.get(file);
    const ext = path.extname(file).slice(1).toLowerCase();
    if (ext === 'svg' && depth < 2) {
      // Kindle often wraps one raster cover in SVG to fit the viewport.
      // Extract that image without executing SVG or loading external URLs.
      const { parseDocument } = require('htmlparser2');
      const nodes = [], visit = ns => { for (const n of ns || []) { if(n.name) nodes.push(n); visit(n.children); } };
      const data = await readImage(file); if(!data) return null;
      visit(parseDocument(data.toString('utf8'),{xmlMode:true}).children);
      const refs = nodes.filter(n=>n.name==='image');
      if (refs.length!==1 || nodes.some(n=>!['svg','g','image','title','desc'].includes(n.name))) return null;
      const src = refs[0].attribs['xlink:href'] || refs[0].attribs.href;
      const id = src ? await image(path.resolve(path.dirname(file),src),depth+1) : null;
      images.set(file,id); return id;
    }
    const mime = {jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',gif:'image/gif',bmp:'image/bmp',webp:'image/webp'}[ext];
    if (!mime) return null;
    const data = await readImage(file); if(!data) return null;
    const id = addAsset(data,ext,mime); images.set(file,id); return id;
  };
  try {
    book = await (info.kf8?initKf8File:initMobiFile)(new Uint8Array(withExth(buffer,info)),temp);
    // Version 0.4.6 assumes every KF8 stylesheet link is a Kindle resource.
    // Our own book styles replace source CSS, so omit links before that parser
    // step. Keep its XHTML reconstruction and embedded-image extraction.
    if (info.kf8) {
      const replace = book.replace.bind(book);
      book.replace = html => replace(html.replace(/<link\b[^>]*>/gi,''));
    } else {
      const replace = book.replace.bind(book);
      // The legacy reader assumes every img has recindex. Preserve unsupported
      // image tags for our HTML adapter to report, rather than losing the book.
      book.replace = html => replace(html.replace(/<img\b[^>]*>/gi,tag=>{
        const rec = tag.match(/\brecindex\s*=\s*["']?(\d+)/i);
        if (!rec) return tag.replace(/^<img/i,'<IMG');
        return tag.replace(/^<img/i,'<img').replace(/\brecindex\s*=\s*["']?(\d+)["']?/i,'recindex="$1"');
      }));
    }
    const metadata = book.getMetadata();
    const title = metadata.title || '';
    const author = (metadata.author || []).join('; ');
    const language = metadata.language === 'unknown' ? '' : metadata.language || '';
    let coverAssetId = null;
    const cover = info.header.exth.get(201) || info.header.exth.get(202);
    if (cover?.length===4) {
      const index = info.header.r.readUInt32BE(108)+cover.readUInt32BE(0);
      if (index<info.offsets.length) {
        const data = info.record(index);
        const png = data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
        const jpg = data[0]===255 && data[1]===216;
        if(png || jpg) coverAssetId = addAsset(data,png?'png':'jpg',png?'image/png':'image/jpeg');
      }
    }
    const titles = new Map();
    const toc = items => { for(const item of items || []) { try {const target=book.resolveHref(item.href); if(target && !titles.has(target.id)) titles.set(target.id,item.label);} catch {/* A broken navigation entry must not discard body text. */} toc(item.children); } };
    toc(book.getToc());
    const sections = [];
    for (const part of book.getSpine()) {
      const loaded = book.loadChapter(part.id);
      if (!loaded?.html) continue;
      const resources = new Map();
      // Read only extracted local resources; never fetch HTML URLs.
      const {parseDocument} = require('htmlparser2');
      const findImages = async nodes => { for (const node of nodes || []) { if(node.name==='img') {const src=node.attribs?.src; if(src) resources.set(src,await image(src));} await findImages(node.children); } };
      await findImages(parseDocument(loaded.html).children);
      const raw = parseHtml(loaded.html,src=>resources.get(src),warnings);
      sections.push(...splitHtmlSections(raw,titles.get(part.id) || ''));
    }
    if (!sections.length) throw new Error('В книге не найдено содержимое');
    return {sections,title,author,language,coverAssetId,encoding:'Kindle',warnings:[...new Set(warnings)]};
  } finally {
    // Remove only the temporary directory created by this import operation.
    const real = await fs.realpath(temp);
    if (path.dirname(real).toLowerCase()===parent.toLowerCase() && path.basename(real).startsWith('pdfmaker-kindle-')) await fs.rm(real,{recursive:true,force:true,maxRetries:3});
  }
}
module.exports = { parseKindle };

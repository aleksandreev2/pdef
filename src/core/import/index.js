'use strict';

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const JSZip = require('jszip');

const { makeChapter, runsText, KIND, KIND_ORDER } = require('../model');
const { fromFilename } = require('../parse/titles');
const { buildBlocks } = require('../parse/blocks');
const { parseDocx } = require('./docx');
const { parseTxt } = require('./txt');
const { parseFb2 } = require('./fb2');
const { parseKindle } = require('./kindle');
const { parseHeading } = require('../parse/titles');

const TEXT_EXT = new Set(['txt', 'text', 'md']);
const DOC_EXT = new Set(['docx', 'gdocx', 'docm']);
const BOOK_EXT = new Set(['fb2', 'mobi', 'azw3']);
const IMG_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp']);
const IMG_MIME = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
};

function extOf(name) {
  const m = String(name).match(/\.([A-Za-z0-9]+)$/);
  return m ? m[1].toLowerCase() : '';
}

function isJunk(name) {
  const base = path.basename(name);
  if (base.startsWith('~$') || base.startsWith('._')) return true;
  if (base === '.DS_Store' || base === 'Thumbs.db' || base === 'desktop.ini') return true;
  if (name.includes('__MACOSX')) return true;
  return false;
}

/** Натуральная сортировка: «9» перед «10». */
function naturalCompare(a, b) {
  return String(a).localeCompare(String(b), 'ru', { numeric: true, sensitivity: 'base' });
}

/* ───────────────────────── раскрытие входных путей ───────────────────────── */

/** @returns {Promise<Array<{name:string, relPath:string, buffer:Buffer, origin:string}>>} */
async function collectFiles(inputPaths, warnings) {
  const files = [];

  async function walkDir(dir, origin) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries.sort((x, y) => naturalCompare(x.name, y.name))) {
      const full = path.join(dir, e.name);
      if (isJunk(full)) continue;
      if (e.isDirectory()) await walkDir(full, origin);
      else await takeFile(full, origin);
    }
  }

  async function expandZip(zipPath, buffer, origin) {
    const zip = await JSZip.loadAsync(buffer);
    const names = Object.keys(zip.files).sort(naturalCompare);
    for (const name of names) {
      const entry = zip.files[name];
      if (entry.dir || isJunk(name)) continue;
      const ext = extOf(name);
      if (!TEXT_EXT.has(ext) && !DOC_EXT.has(ext) && !BOOK_EXT.has(ext) && !IMG_EXT.has(ext)) continue;
      const data = await entry.async('nodebuffer');
      files.push({
        name: path.basename(name),
        relPath: `${path.basename(zipPath)}/${name}`,
        buffer: data,
        origin,
      });
    }
  }

  async function takeFile(full, origin) {
    const ext = extOf(full);
    if (ext === 'zip') {
      const buffer = await fs.readFile(full);
      await expandZip(full, buffer, origin || full);
      return;
    }
    if (!TEXT_EXT.has(ext) && !DOC_EXT.has(ext) && !BOOK_EXT.has(ext) && !IMG_EXT.has(ext)) return;
    const buffer = await fs.readFile(full);
    files.push({ name: path.basename(full), relPath: full, buffer, origin: origin || full });
  }

  for (const p of inputPaths) {
    try {
      const st = await fs.stat(p);
      if (st.isDirectory()) await walkDir(p, p);
      else await takeFile(p, p);
    } catch (e) {
      warnings.push(`Не удалось прочитать ${p}: ${e.message}`);
    }
  }

  return files;
}

/* ───────────────────────────── основной импорт ───────────────────────────── */

/**
 * Разбирает исходники в единое представление (один проход, п.0 спецификации).
 *
 * @param {string[]} inputPaths  файлы, папки и ZIP-архивы
 * @param {{onProgress?:(p:{done:number,total:number,label:string})=>void}} [opts]
 * @returns {Promise<{chapters:Array, assets:Map, loose:Array, warnings:string[]}>}
 */
async function importSources(inputPaths, opts = {}) {
  const warnings = [];
  const onProgress = opts.onProgress || (() => {});

  const files = await collectFiles(inputPaths, warnings);
  if (!files.length) {
    return { chapters: [], assets: new Map(), loose: [], warnings: ['Не найдено файлов TXT, DOCX, FB2, MOBI или AZW3'] };
  }

  /* Реестр ресурсов с дедупликацией по SHA-1: одна и та же иллюстрация,
     встречающаяся в нескольких файлах, попадает в книгу один раз. */
  const assets = new Map();
  const byHash = new Map();
  const addAsset = (data, ext, mime) => {
    const hash = crypto.createHash('sha1').update(data).digest('hex');
    if (byHash.has(hash)) return byHash.get(hash);
    const id = `img${String(assets.size + 1).padStart(3, '0')}`;
    assets.set(id, { id, ext, mime: mime || IMG_MIME[ext] || 'application/octet-stream', data, hash });
    byHash.set(hash, id);
    return id;
  };

  const chapters = [];
  const loose = []; // изображения, положенные рядом (кандидаты в обложку)

  const docs = files.filter((f) => {
    const ext = extOf(f.name);
    return TEXT_EXT.has(ext) || DOC_EXT.has(ext) || BOOK_EXT.has(ext);
  });
  const images = files.filter((f) => IMG_EXT.has(extOf(f.name)));

  for (const img of images) {
    const ext = extOf(img.name);
    const id = addAsset(img.buffer, ext, IMG_MIME[ext]);
    loose.push({ assetId: id, name: img.name, path: img.relPath });
  }

  function appendChapter(file, rawParas, section, issues, encoding, sourceOrder) {
    const { blocks, droppedTitle, headingFromText } = buildBlocks(rawParas, section);
    if (droppedTitle) issues.push('Заголовок документа перенесён в название раздела');
    if (headingFromText) {
      if (section.number !== null && headingFromText.number !== null && section.number !== headingFromText.number) {
        issues.push(`Номер в имени файла (${section.number}) отличается от заголовка (${headingFromText.number}); выбран номер из документа`);
      }
      if (headingFromText.title || section.number === null) section.title = headingFromText.title;
      section.number = headingFromText.number;
      if (!section.fixedKind) section.kind = headingFromText.kind;
    }
    if (sourceOrder !== undefined && !blocks.length) return;
    const hasText = blocks.some(b => b.type === 'para' || b.type === 'system' || b.type === 'list' || b.type === 'heading');
    const imageCount = blocks.filter(b => b.type === 'image').length;
    let kind = section.kind;
    if (!hasText && imageCount > 0 && kind === KIND.CHAPTER && section.number === null) kind = KIND.COVER_GALLERY;
    if (!blocks.length) issues.push('Файл пустой — нет ни текста, ни иллюстраций');
    chapters.push(makeChapter({ id: `ch${chapters.length + 1}`, sourceFile: file.relPath,
      sourceName: sourceOrder === undefined ? file.name : `${file.name} — ${String(sourceOrder+1).padStart(4,'0')}. ${section.title || 'Раздел'}`,
      kind, number: section.number, title: section.title, blocks, include: blocks.length > 0, issues, encoding,
      ...(sourceOrder === undefined ? {} : { sourceGroup: file.relPath, sourceOrder }),
    }));
  }
  const bookMetadata = [];
  let done = 0;
  for (const file of docs) {
    done += 1;
    onProgress({ done, total: docs.length, label: file.name });

    const ext = extOf(file.name);
    const section = fromFilename(file.name);
    const issues = [];
    let rawParas = [];
    let encoding = null;

    try {
      if (BOOK_EXT.has(ext)) {
        const res = ext === 'fb2' ? parseFb2(file.buffer,addAsset) : await parseKindle(file.buffer,addAsset);
        const before = chapters.length;
        for (let i=0;i<res.sections.length;i++) {
          const part = res.sections[i];
          const label = part.title || (res.sections.length===1 ? res.title : '') || 'Раздел '+(i+1);
          const heading = parseHeading(label);
          const parsed = heading || { title: label, number: null, kind: KIND.CHAPTER };
          let raw = part.rawParas;
          const first = raw[0];
          // Numbered headings are removed by buildBlocks. A named heading has
          // already supplied this section's title; preserve other subheadings.
          if (!heading && /^Heading[12]$/.test(first?.style || '') &&
              runsText(first.runs || []).trim().replace(/\s+/g,' ') === label.trim().replace(/\s+/g,' ')) {
            const next = raw[1];
            if (/^Heading[12]$/.test(next?.style || '') && parseHeading(runsText(next.runs || []))) {
              // The next heading supplies a chapter number/title. Keep its
              // parent part label in the body while buildBlocks reads the child.
              raw = [next,{...first,style:'Heading3'},...raw.slice(2)];
            } else raw = raw.slice(1);
          }
          if (part.kind) { parsed.kind = part.kind; parsed.fixedKind = true; }
          appendChapter(file,raw,parsed,[...res.warnings],res.encoding,i);
        }
        if (chapters.length===before) throw new Error('В книге не найдено текста или иллюстраций');
        if (res.coverAssetId) loose.push({assetId:res.coverAssetId,name:'Обложка — '+file.name,path:file.relPath});
        bookMetadata.push({title:res.title || '',author:res.author || '',language:res.language || ''});
        continue;
      } else if (DOC_EXT.has(ext)) {
        const res = await parseDocx(file.buffer, addAsset);
        rawParas = res.rawParas;
        issues.push(...res.warnings);
      } else {
        const res = parseTxt(file.buffer);
        rawParas = res.rawParas;
        encoding = res.encoding;
        issues.push(...res.warnings);
      }
    } catch (e) {
      chapters.push(
        makeChapter({
          id: `ch${chapters.length + 1}`,
          sourceFile: file.relPath,
          sourceName: file.name,
          kind: section.kind,
          number: section.number,
          title: section.title,
          blocks: [],
          include: false,
          issues: [`Файл не разобран: ${e.message}`],
        }),
      );
      continue;
    }

    appendChapter(file,rawParas,section,issues,encoding);
  }

  sortChapters(chapters);
  return { chapters, assets, loose, warnings, ...(bookMetadata.length===1 ? bookMetadata[0] : {}) };
}

/** Порядок чтения: тип раздела → номер → имя файла. */
function sortChapters(chapters) {
  // A complete ebook is one sorting unit; its native section order is retained.
  const groups = new Map(), units = [];
  for (const ch of chapters) {
    if (ch.sourceGroup) {
      if (!groups.has(ch.sourceGroup)) { const unit=[]; groups.set(ch.sourceGroup,unit); units.push(unit); }
      groups.get(ch.sourceGroup).push(ch);
    } else units.push([ch]);
  }
  for (const unit of groups.values()) unit.sort((a,b)=>a.sourceOrder-b.sourceOrder);
  units.sort(([a], [b]) => {
    const ka = KIND_ORDER[a.kind] ?? 2;
    const kb = KIND_ORDER[b.kind] ?? 2;
    if (ka !== kb) return ka - kb;
    if (a.number !== null && b.number !== null && a.number !== b.number) return a.number - b.number;
    if (a.number !== null && b.number === null) return -1;
    if (a.number === null && b.number !== null) return 1;
    return naturalCompare(a.sourceName, b.sourceName);
  });
  chapters.splice(0,chapters.length,...units.flat());
  return chapters;
}

module.exports = { importSources, sortChapters, naturalCompare };

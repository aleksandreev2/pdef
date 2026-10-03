'use strict';

const JSZip = require('jszip');
const { XMLParser } = require('fast-xml-parser');
const { makeRun } = require('../model');

const EMU_PER_PT = 12700; // 914400 EMU = 1 inch = 72 pt

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  preserveOrder: true,
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: true,
});

/* ───────────────────────── обход preserveOrder-дерева ───────────────────────── */

function tagName(node) {
  for (const k of Object.keys(node)) {
    if (k !== ':@') return k;
  }
  return null;
}

function kids(node) {
  const name = tagName(node);
  const v = name ? node[name] : null;
  return Array.isArray(v) ? v : [];
}

function attrs(node) {
  return node[':@'] || {};
}

function findAll(node, name) {
  return kids(node).filter((c) => tagName(c) === name);
}

function find(node, name) {
  return kids(node).find((c) => tagName(c) === name) || null;
}

/** Поиск первого узла с данным именем на любой глубине. */
function findDeep(node, name) {
  const stack = [...kids(node)];
  while (stack.length) {
        const cur = stack.shift();
    if (tagName(cur) === name) return cur;
    stack.push(...kids(cur));
  }
  return null;
}

function textOf(node) {
  const t = kids(node).find((c) => Object.prototype.hasOwnProperty.call(c, '#text'));
  return t ? String(t['#text']) : '';
}

function onOff(parent, name) {
  const el = find(parent, name);
  if (!el) return false;
  const v = attrs(el)['@w:val'];
  if (v === undefined) return true;
  return !(v === '0' || v === 'false' || v === 'none');
}

/* ───────────────────────────────── MIME ───────────────────────────────── */

const MIME = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  emf: 'image/emf',
  wmf: 'image/wmf',
};

function extOf(path) {
  const m = String(path).match(/\.([A-Za-z0-9]+)$/);
  return m ? m[1].toLowerCase() : 'bin';
}

/* ─────────────────────────────── парсинг ─────────────────────────────── */

/**
 * @param {Buffer} buffer  содержимое .docx
 * @param {(data:Buffer, ext:string, mime:string)=>string} addAsset  регистратор ресурсов (дедуп по хешу)
 * @returns {Promise<{rawParas:Array, warnings:string[]}>}
 */
async function parseDocx(buffer, addAsset) {
  const warnings = [];
  const zip = await JSZip.loadAsync(buffer);

  const docFile = zip.file('word/document.xml');
  if (!docFile) throw new Error('В .docx нет word/document.xml — файл повреждён или это не DOCX');

  const docXml = await docFile.async('string');
  const tree = parser.parse(docXml);

  // Связи rId → цель
  const rels = new Map();
  const relFile = zip.file('word/_rels/document.xml.rels');
  if (relFile) {
    const relTree = parser.parse(await relFile.async('string'));
    const rootRel = relTree.find((n) => tagName(n) === 'Relationships');
    if (rootRel) {
      for (const r of findAll(rootRel, 'Relationship')) {
        const a = attrs(r);
        rels.set(a['@Id'], { target: a['@Target'], mode: a['@TargetMode'], type: a['@Type'] });
      }
    }
  }

  // Нумерация: numId → ordered?
  const numOrdered = await readNumbering(zip, warnings);

  // Кэш зарегистрированных картинок: rId → assetId
  const imageCache = new Map();
  const mediaAsset = async (rid) => {
    if (imageCache.has(rid)) return imageCache.get(rid);
    const rel = rels.get(rid);
    if (!rel || !rel.target) return null;
    const target = String(rel.target).replace(/^\.?\/?/, '');
    const path = target.startsWith('media/') || target.startsWith('word/') ? (target.startsWith('word/') ? target : `word/${target}`) : `word/${target}`;
    const file = zip.file(path) || zip.file(target);
    if (!file) {
      warnings.push(`Иллюстрация не найдена в архиве: ${target}`);
      return null;
    }
    const data = await file.async('nodebuffer');
    const ext = extOf(path);
    const id = addAsset(data, ext, MIME[ext] || 'application/octet-stream');
    imageCache.set(rid, id);
    return id;
  };

  const root = tree.find((n) => tagName(n) === 'w:document');
  const body = root ? find(root, 'w:body') : null;
  if (!body) throw new Error('В .docx нет w:body');

  const rawParas = [];
  for (const node of kids(body)) {
    const name = tagName(node);
    if (name === 'w:p') {
      await emitParagraph(node, rawParas, { rels, mediaAsset, numOrdered });
    } else if (name === 'w:tbl') {
      await emitTable(node, rawParas, { rels, mediaAsset });
    }
  }

  return { rawParas, warnings };
}

async function readNumbering(zip, warnings) {
  const map = new Map();
  const f = zip.file('word/numbering.xml');
  if (!f) return map;
  try {
    const tree = parser.parse(await f.async('string'));
    const root = tree.find((n) => tagName(n) === 'w:numbering');
    if (!root) return map;
    const abstractFmt = new Map();
    for (const a of findAll(root, 'w:abstractNum')) {
      const id = attrs(a)['@w:abstractNumId'];
      const lvl = find(a, 'w:lvl');
      const fmt = lvl ? find(lvl, 'w:numFmt') : null;
      const val = fmt ? attrs(fmt)['@w:val'] : 'bullet';
      abstractFmt.set(id, val !== 'bullet' && val !== 'none');
    }
    for (const n of findAll(root, 'w:num')) {
      const numId = attrs(n)['@w:numId'];
      const abs = find(n, 'w:abstractNumId');
      const absId = abs ? attrs(abs)['@w:val'] : null;
      map.set(numId, abstractFmt.get(absId) || false);
    }
  } catch (e) {
    warnings.push(`Не удалось прочитать numbering.xml: ${e.message}`);
  }
  return map;
}

async function emitParagraph(p, out, ctx) {
  const pPr = find(p, 'w:pPr');
  let style = '';
  let align = '';
  let list = null;

  if (pPr) {
    const st = find(pPr, 'w:pStyle');
    if (st) style = attrs(st)['@w:val'] || '';
    const jc = find(pPr, 'w:jc');
    if (jc) align = attrs(jc)['@w:val'] || '';
    const numPr = find(pPr, 'w:numPr');
    if (numPr) {
      const numId = find(numPr, 'w:numId');
      const ilvl = find(numPr, 'w:ilvl');
      const id = numId ? attrs(numId)['@w:val'] : null;
      if (id && id !== '0') {
        list = { ordered: !!ctx.numOrdered.get(id), level: ilvl ? Number(attrs(ilvl)['@w:val'] || 0) : 0 };
      }
    }
  }

  // Параграф может содержать текст и/или картинки; w:br режет его на строки.
  let runs = [];
  const flushText = () => {
    if (runs.some((r) => r.text.trim())) out.push({ runs, style, align, list });
    runs = [];
  };

  const walkRuns = async (container, inheritedLink) => {
    for (const node of kids(container)) {
      const name = tagName(node);

      if (name === 'w:hyperlink') {
        const a = attrs(node);
        let href = inheritedLink;
        if (a['@r:id']) {
          const rel = ctx.rels.get(a['@r:id']);
          if (rel && rel.mode === 'External') href = rel.target;
        } else if (a['@w:anchor']) {
          href = undefined; // внутренние ссылки исходника не переносим
        }
        await walkRuns(node, href);
        continue;
      }

      if (name !== 'w:r') continue;

      const rPr = find(node, 'w:rPr');
      const fmt = {
        b: rPr ? onOff(rPr, 'w:b') : false,
        i: rPr ? onOff(rPr, 'w:i') : false,
        u: rPr ? !!find(rPr, 'w:u') && (attrs(find(rPr, 'w:u'))['@w:val'] || 'single') !== 'none' : false,
        link: inheritedLink,
      };

      for (const child of kids(node)) {
        const cn = tagName(child);
        if (cn === 'w:t') {
          runs.push(makeRun(textOf(child), fmt));
        } else if (cn === 'w:tab') {
          runs.push(makeRun(' ', fmt));
        } else if (cn === 'w:br') {
          flushText();
        } else if (cn === 'w:drawing' || cn === 'w:pict' || cn === 'w:object') {
          const img = await readImage(child, ctx);
          if (img) {
            flushText();
            out.push({ image: img });
          }
        }
      }
    }
  };

  await walkRuns(p, undefined);
  flushText();
}

async function readImage(node, ctx) {
  // DrawingML: wp:inline | wp:anchor → a:blip@r:embed
  const blip = findDeep(node, 'a:blip');
  if (blip) {
    const rid = attrs(blip)['@r:embed'] || attrs(blip)['@r:link'];
    if (rid) {
      const assetId = await ctx.mediaAsset(rid);
      if (assetId) {
        const holder = find(node, 'wp:inline') || find(node, 'wp:anchor');
        const extent = holder ? find(holder, 'wp:extent') : null;
        const docPr = holder ? find(holder, 'wp:docPr') : null;
        const a = extent ? attrs(extent) : {};
        return {
          assetId,
          alt: (docPr && (attrs(docPr)['@descr'] || attrs(docPr)['@name'])) || 'Иллюстрация',
          w: a['@cx'] ? Number(a['@cx']) / EMU_PER_PT : null,
          h: a['@cy'] ? Number(a['@cy']) / EMU_PER_PT : null,
        };
      }
    }
  }
  // VML: v:imagedata@r:id
  const imageData = findDeep(node, 'v:imagedata');
  if (imageData) {
    const rid = attrs(imageData)['@r:id'];
    if (rid) {
      const assetId = await ctx.mediaAsset(rid);
      if (assetId) return { assetId, alt: 'Иллюстрация', w: null, h: null };
    }
  }
  return null;
}

/** Таблица → системный блок: структура сохраняется, в прозу не превращается. */
async function emitTable(tbl, out, ctx) {
  const lines = [];
  for (const tr of findAll(tbl, 'w:tr')) {
    const cells = [];
    for (const tc of findAll(tr, 'w:tc')) {
      const sub = [];
      for (const p of findAll(tc, 'w:p')) {
        await emitParagraph(p, sub, { ...ctx, numOrdered: new Map() });
      }
      const text = sub
        .filter((s) => s.runs)
        .map((s) => s.runs.map((r) => r.text).join(''))
        .join(' ')
        .trim();
      cells.push(text);
    }
    const line = cells.filter(Boolean).join('  ·  ');
    if (line) lines.push([makeRun(line)]);
  }
  if (lines.length) out.push({ table: true, lines });
}

module.exports = { parseDocx };

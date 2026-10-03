'use strict';

const fs = require('fs/promises');
const crypto = require('crypto');
const JSZip = require('jszip');

const T = require('./templates');
const { chapterLabel } = require('../model');
const { fmtNumber, plural } = require('../pdf/build');

/**
 * Сборка EPUB 3 (reflowable) из того же представления книги, что и PDF.
 * mimetype записывается первым и без сжатия; nav.xhtml существует,
 * но в spine не попадает — отдельной видимой страницы оглавления нет.
 */

const EXT_MIME = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
};

function pad(n, len = 3) {
  return String(n).padStart(len, '0');
}

async function buildEpub({ book, style, outPath, onProgress = () => {} }) {
  const warnings = [];
  const zip = new JSZip();

  // 1. mimetype — первым и без сжатия
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

  // 2. META-INF
  zip.file('META-INF/container.xml', T.containerXml());

  const active = book.chapters.filter((c) => c.include && c.blocks.length);
  const uuid = book.uuid || crypto.randomUUID();
  const bookMeta = { ...book, uuid };

  const items = [];
  const spine = [];
  const navEntries = [];

  /* ── ресурсы: только реально использованные иллюстрации ── */
  const usedAssets = new Set();
  for (const ch of active) {
    for (const b of ch.blocks) if (b.type === 'image' && b.assetId) usedAssets.add(b.assetId);
  }
  if (book.cover) usedAssets.add(book.cover.assetId);

  const assetHref = new Map();
  let imgIndex = 0;
  for (const assetId of usedAssets) {
    const asset = book.assets.get(assetId);
    if (!asset) {
      warnings.push(`Ресурс ${assetId} отсутствует и пропущен`);
      continue;
    }
    imgIndex += 1;
    const isCover = book.cover && book.cover.assetId === assetId;
    const ext = asset.ext === 'jpeg' ? 'jpg' : asset.ext;
    const name = isCover ? `cover.${ext}` : `img${pad(imgIndex)}.${ext}`;
    const href = `images/${name}`;
    assetHref.set(assetId, href);
    zip.file(`EPUB/${href}`, asset.data);
    items.push({
      id: isCover ? 'cover-image' : `img${pad(imgIndex)}`,
      href,
      type: EXT_MIME[ext] || asset.mime || 'application/octet-stream',
      properties: isCover ? 'cover-image' : undefined,
    });
  }

  const hrefOfAssetFrom = (fromDir) => (assetId) => {
    const href = assetHref.get(assetId);
    if (!href) return null;
    return fromDir === 'text' ? `../${href}` : href;
  };

  /* ── CSS ── */
  zip.file('EPUB/css/style.css', T.css(style));
  items.push({ id: 'css', href: 'css/style.css', type: 'text/css' });

  /* ── обложка ── */
  if (book.cover) {
    const href = assetHref.get(book.cover.assetId);
    zip.file('EPUB/text/cover.xhtml', T.coverXhtml(bookMeta, `../${href}`, `Обложка: ${book.title}`));
    items.push({ id: 'cover', href: 'text/cover.xhtml', type: 'application/xhtml+xml' });
    spine.push('cover');
  } else {
    warnings.push('Обложка не задана — страница обложки в EPUB не создана');
  }

  /* ── титульная ── */
  const stats = book.stats || { words: 0, chapters: active.length };
  const counts = {
    chapters: `${fmtNumber(stats.chapters)} ${plural(stats.chapters, 'глава', 'главы', 'глав')}`,
    words: `${fmtNumber(stats.words)} ${plural(stats.words, 'слово', 'слова', 'слов')}`,
  };
  zip.file('EPUB/text/title.xhtml', T.titleXhtml(bookMeta, style, counts));
  items.push({ id: 'titlepage', href: 'text/title.xhtml', type: 'application/xhtml+xml', properties: style.signature ? 'svg' : undefined });
  spine.push('titlepage');

  /* ── сведения о переводе ── */
  zip.file('EPUB/text/about.xhtml', T.aboutXhtml(bookMeta));
  items.push({ id: 'about', href: 'text/about.xhtml', type: 'application/xhtml+xml' });
  spine.push('about');

  /* ── главы: отдельный XHTML на каждый реальный раздел ── */
  const hrefOfAsset = hrefOfAssetFrom('text');
  for (let i = 0; i < active.length; i += 1) {
    const ch = active[i];
    const id = `ch${pad(i + 1)}`;
    const href = `text/${id}.xhtml`;
    const xhtml = T.chapterXhtml(bookMeta, ch, style, hrefOfAsset);
    zip.file(`EPUB/${href}`, xhtml);
    items.push({ id, href, type: 'application/xhtml+xml', properties: xhtml.includes('<svg') ? 'svg' : undefined });
    spine.push(id);
    navEntries.push({ href, label: chapterLabel(ch) });
    if (i % 20 === 0 || i === active.length - 1) {
      onProgress({ phase: 'epub', label: `EPUB: ${chapterLabel(ch)}`, done: i + 1, total: active.length });
    }
  }

  /* ── nav.xhtml: в manifest, но НЕ в spine ── */
  zip.file('EPUB/nav.xhtml', T.navXhtml(bookMeta, navEntries));
  items.push({ id: 'nav', href: 'nav.xhtml', type: 'application/xhtml+xml', properties: 'nav' });

  /* ── package.opf ── */
  const modified = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  zip.file('EPUB/package.opf', T.packageOpf(bookMeta, items, spine, modified));

  onProgress({ phase: 'epub', label: 'Упаковка EPUB' });
  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 8 },
    mimeType: 'application/epub+zip',
  });
  await fs.writeFile(outPath, buffer);

  return {
    outPath,
    size: buffer.length,
    documents: spine.length,
    chapters: active.length,
    images: usedAssets.size,
    warnings,
  };
}

module.exports = { buildEpub };

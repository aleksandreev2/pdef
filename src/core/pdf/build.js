'use strict';

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const { geometry, mm } = require('../style');
const { createMeasurer, layoutText, tokenize, FONT } = require('./typeset');
const { buildChapterFlow, paginate } = require('./layout');
const { renderPage, drawLine } = require('./render');
const { drawTitleMark, drawPageFrame } = require('../signature');
const { chapterLabel, chapterKicker } = require('../model');

/**
 * Сборка мобильного PDF из единого представления книги.
 * Пагинация выполняется один раз: число страниц оглавления определяется
 * до вёрстки глав (оно зависит только от количества и длины названий),
 * поэтому повторные полные прогоны не нужны.
 */

const TOC_LINE_FACTOR = 1.42;

function fmtNumber(n) {
  return new Intl.NumberFormat('ru-RU').format(n);
}

function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

async function buildPdf({ book, style, fonts, outPath, onProgress = () => {} }) {
  const geom = geometry(style);
  const warnings = [];

  const doc = new PDFDocument({
    size: [geom.pageW, geom.pageH],
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    autoFirstPage: false,
    bufferPages: true,
    pdfVersion: '1.7',
    lang: book.language || 'ru',
    displayTitle: true,
    info: {
      Title: book.title,
      Author: book.author || book.team,
      Subject: `${book.title} — ${book.subtitle}`,
      Keywords: `${book.title}, ${book.team}, ранобэ, перевод`,
      Creator: 'PDFMaker Mobile v3',
      Producer: `PDFMaker Mobile — ${book.team}`,
    },
  });

  const stream = fs.createWriteStream(outPath);
  const done = new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
  doc.pipe(stream);

  const measurer = createMeasurer(doc, fonts);
  const measure = measurer.width;

  /* ── размеры изображений ── */
  const imgCache = new Map();
  const imageSize = (assetId, srcW, srcH) => {
    if (imgCache.has(assetId)) return imgCache.get(assetId);
    const asset = book.assets.get(assetId);
    let dims = { w: srcW || 200, h: srcH || 280 };
    if (asset) {
      try {
        const img = doc.openImage(asset.data);
        dims = { w: img.width, h: img.height };
        asset.pxW = img.width;
        asset.pxH = img.height;
      } catch (e) {
        warnings.push(`Иллюстрация ${assetId} не читается: ${e.message}`);
      }
    }
    imgCache.set(assetId, dims);
    return dims;
  };

  const ctx = { style, geom, measure, fontParts: measurer.parts, assets: book.assets, book, warnings, imageSize };

  /* ── 1. поток глав ── */
  const active = book.chapters.filter((c) => c.include && c.blocks.length);
  onProgress({ phase: 'layout', label: 'Вёрстка глав', done: 0, total: active.length });

  const flowByChapter = [];
  for (let i = 0; i < active.length; i += 1) {
    const ch = active[i];
    flowByChapter.push({ chapter: ch, items: buildChapterFlow(ch, ctx) });
    if (i % 10 === 0 || i === active.length - 1) {
      onProgress({ phase: 'layout', label: `Вёрстка: ${chapterLabel(ch)}`, done: i + 1, total: active.length });
    }
  }

  /* ── 2. оглавление: строки и число страниц ── */
  const tocHeaderH = style.chapterTitleSize * 1.1 + mm(5);
  const numReserve = measure('000', FONT.sans, style.tocSize) + 8;
  const tocLineStep = style.tocSize * TOC_LINE_FACTOR;

  const tocEntries = active.map((ch) => {
    const label = chapterLabel(ch);
    const lines = layoutText(tokenize([{ text: label }], 'serif'), {
      width: geom.contentW - numReserve,
      size: style.tocSize,
      firstIndent: 0,
      justify: false,
      hyphenate: false,
      align: 'left',
      measure,
    });
    return { chapter: ch, label, lines, h: lines.length * tocLineStep + tocLineStep * 0.28 };
  });

  const tocPages = [[]];
  {
    let y = tocHeaderH;
    for (const entry of tocEntries) {
      if (y + entry.h > geom.contentH && tocPages[tocPages.length - 1].length) {
        tocPages.push([]);
        y = 0;
      }
      tocPages[tocPages.length - 1].push({ ...entry, localY: y });
      y += entry.h;
    }
  }
  const tocPageCount = tocPages.length;

  /* ── 3. пагинация глав ── */
  const hasCover = !!book.cover;
  const frontPages = (hasCover ? 1 : 1) + 1 + tocPageCount; // обложка + титул + оглавление
  const translationPageIndex = frontPages; // 0-based
  const contentStartIndex = frontPages + 1;

  onProgress({ phase: 'paginate', label: 'Разбивка на страницы' });
  const { pages, chapterStarts } = paginate(flowByChapter, ctx);

  const pageNumberOf = (localIndex) => contentStartIndex + localIndex + 1; // 1-based для показа

  /* ── 4. рендер по порядку ── */
  const bookmarks = [];

  // 4.1 Обложка — первая страница, без номера и колонтитула
  doc.addPage();
  if (hasCover) {
    drawCover(doc, book, geom, warnings, style);
  } else {
    drawTypographicCover(doc, book, geom, style, ctx);
    warnings.push('Изображение обложки не задано — собрана типографическая обложка');
  }

  // 4.2 Титульная
  doc.addPage();
  doc.addNamedDestination('nav_title');
  bookmarks.push({ title: 'Титульная страница', pageNumber: 1 });
  drawTitlePage(doc, book, geom, style, ctx, active.length);

  // 4.3 Оглавление
  for (let p = 0; p < tocPages.length; p += 1) {
    doc.addPage();
    if (p === 0) {
      doc.addNamedDestination('nav_toc');
      bookmarks.push({ title: 'Оглавление', pageNumber: 2 });
    }
    drawTocPage(doc, tocPages[p], {
      ctx,
      first: p === 0,
      headerH: tocHeaderH,
      numReserve,
      tocLineStep,
      pageOf: (ch) => pageNumberOf(chapterStarts.get(ch.id)),
    });
    drawPlainFolio(doc, 3 + p, ctx);
  }

  // 4.4 Сведения о переводе
  doc.addPage();
  doc.addNamedDestination('nav_about');
  bookmarks.push({ title: 'О переводе', pageNumber: translationPageIndex });
  drawTranslationPage(doc, book, geom, style, ctx);
  drawPlainFolio(doc, translationPageIndex + 1, ctx);

  // 4.5 Главы
  onProgress({ phase: 'render', label: 'Отрисовка страниц', done: 0, total: pages.length });
  const chapterByStart = new Map();
  for (const [chId, idx] of chapterStarts) chapterByStart.set(idx, chId);

  for (let i = 0; i < pages.length; i += 1) {
    doc.addPage();
    const chId = chapterByStart.get(i);
    if (chId) {
      doc.addNamedDestination(`dest_${chId}`);
      const ch = active.find((c) => c.id === chId);
      if (ch) bookmarks.push({ title: chapterLabel(ch), pageNumber: contentStartIndex + i });
    }
    renderPage(doc, pages[i], pageNumberOf(i), ctx);
    if (i % 25 === 0 || i === pages.length - 1) {
      onProgress({ phase: 'render', label: `Страница ${i + 1} из ${pages.length}`, done: i + 1, total: pages.length });
    }
  }

  /* ── 5. закладки ── */
  for (const b of bookmarks) {
    doc.outline.addItem(b.title, { pageNumber: b.pageNumber });
  }

  doc.end();
  await done;

  const totalPages = contentStartIndex + pages.length;
  return {
    outPath,
    pages: totalPages,
    contentPages: pages.length,
    tocPages: tocPageCount,
    tocFirstPage: 3,
    firstContentPage: contentStartIndex + 1,
    chapterPages: Object.fromEntries([...chapterStarts].map(([id, idx]) => [id, pageNumberOf(idx)])),
    bookmarks: bookmarks.length,
    warnings,
    size: fs.statSync(outPath).size,
  };
}

/* ─────────────────────────── страницы фронт-матера ─────────────────────────── */

function drawCover(doc, book, geom, warnings, style) {
  const asset = book.assets.get(book.cover.assetId);
  if (!asset) {
    warnings.push('Файл обложки не найден среди ресурсов');
    return;
  }
  try {
    const img = doc.openImage(asset.data);
    const pageRatio = geom.pageW / geom.pageH;
    const imgRatio = img.width / img.height;
    const nearly = Math.abs(imgRatio - pageRatio) / pageRatio < 0.08;
    const mode = style.coverFit || (nearly ? 'cover' : 'contain');

    if (mode === 'cover') {
      // Пропорции сохранены, лишнее уходит за край страницы.
      let w = geom.pageW;
      let h = w / imgRatio;
      if (h < geom.pageH) {
        h = geom.pageH;
        w = h * imgRatio;
      }
      doc.image(asset.data, (geom.pageW - w) / 2, (geom.pageH - h) / 2, { width: w, height: h });
    } else {
      doc.rect(0, 0, geom.pageW, geom.pageH).fillColor('#FFFFFF').fill();
      doc.image(asset.data, 0, 0, { fit: [geom.pageW, geom.pageH], align: 'center', valign: 'center' });
    }
  } catch (e) {
    warnings.push(`Обложка не вставлена: ${e.message}`);
  }
}

function drawTypographicCover(doc, book, geom, style, ctx) {
  doc.rect(0, 0, geom.pageW, geom.pageH).fillColor(style.coverBg).fill();
  drawPageFrame(doc, geom, { ...style, accent: '#CEBA93' });
  const lines = layoutText(tokenize([{ text: book.title }], 'serif'), {
    width: geom.contentW,
    size: 26,
    firstIndent: 0,
    justify: false,
    hyphenate: false,
    align: 'center',
    measure: ctx.measure,
  });
  let y = geom.pageH * 0.34;
  for (const line of lines) {
    drawLine(doc, line, geom.contentX, y, 26, '#F4F1F6', ctx);
    y += 30;
  }
  if (style.signature) drawTitleMark(doc, geom.pageW / 2, y + 14, geom.contentW, '#CEBA93', style.genre);
  doc.font(FONT.sans).fontSize(10).fillColor('#B9B2C2');
  const team = book.team;
  const tw = doc.widthOfString(team);
  doc.text(team, (geom.pageW - tw) / 2, geom.pageH * 0.84, { lineBreak: false });
}

function drawTitlePage(doc, book, geom, style, ctx, sectionCount) {
  drawPageFrame(doc, geom, style);
  const stats = book.stats || { words: 0 };
  let y = geom.contentY + mm(14);

  const titleLines = layoutText(tokenize([{ text: book.title }], 'serif'), {
    width: geom.contentW,
    size: 23,
    firstIndent: 0,
    justify: false,
    hyphenate: false,
    align: 'center',
    measure: ctx.measure,
  });
  for (const line of titleLines) {
    drawLine(doc, line, geom.contentX, y, 23, style.textColor, ctx);
    y += 27;
  }

  y += mm(3);
  if (style.signature) y += drawTitleMark(doc, geom.pageW / 2, y, geom.contentW, style.accent, style.genre) + mm(4);

  const center = (text, font, size, color, gapAfter) => {
    doc.font(font).fontSize(size).fillColor(color);
    const w = doc.widthOfString(text);
    doc.text(text, geom.contentX + (geom.contentW - w) / 2, y, { lineBreak: false });
    y += size * 1.35 + (gapAfter || 0);
  };

  center(book.subtitle || 'Полное издание', FONT.sansB, 11, style.accent, mm(5));

  const chapterCount = book.stats ? book.stats.chapters : sectionCount;
  center(
    `${fmtNumber(chapterCount)} ${plural(chapterCount, 'глава', 'главы', 'глав')}`,
    FONT.sans,
    10,
    '#55525A',
    1,
  );
  center(
    `${fmtNumber(stats.words)} ${plural(stats.words, 'слово', 'слова', 'слов')}`,
    FONT.sans,
    10,
    '#55525A',
    mm(10),
  );

  /* Подпись переводчиков прижата к низу полосы — так титульная читается
     как разворот книги, а не как текст с пустой нижней половиной. */
  y = geom.contentBottom - mm(14);

  // Настоящая кликабельная ссылка на команду.
  doc.font(FONT.serif).fontSize(10.5).fillColor(style.textColor);
  const prefix = 'Перевод выполнен командой ';
  const teamText = book.team;
  const pw = doc.widthOfString(prefix);
  doc.font(FONT.serifB);
  const tw = doc.widthOfString(teamText);
  const totalW = pw + tw;
  let x = geom.contentX + (geom.contentW - totalW) / 2;

  doc.font(FONT.serif).fontSize(10.5).fillColor(style.textColor);
  doc.text(prefix, x, y, { lineBreak: false });
  doc.font(FONT.serifB).fillColor(style.accent);
  doc.text(teamText, x + pw, y, { lineBreak: false });
  // Настоящая Link-аннотация с точными границами названия команды.
  doc.link(x + pw, y - 1, tw, 12.5, book.teamUrl);
}

function drawTocPage(doc, entries, opts) {
  const { ctx, first, headerH, numReserve, tocLineStep, pageOf } = opts;
  const { geom, style } = ctx;

  if (first) {
    doc.font(FONT.serifB).fontSize(style.chapterTitleSize).fillColor(style.textColor);
    doc.text('Оглавление', geom.contentX, geom.contentY, { lineBreak: false });
    doc.lineWidth(0.6).strokeColor(style.accent);
    doc.moveTo(geom.contentX, geom.contentY + style.chapterTitleSize * 1.1 + 4)
      .lineTo(geom.contentX + mm(18), geom.contentY + style.chapterTitleSize * 1.1 + 4)
      .stroke();
  }

  for (const entry of entries) {
    const y = geom.contentY + entry.localY + (first ? 0 : 0);
    const pageNum = pageOf(entry.chapter);

    let ly = y;
    for (const line of entry.lines) {
      drawLine(doc, line, geom.contentX, ly, style.tocSize, style.textColor, ctx);
      ly += tocLineStep;
    }

    /* Номер страницы ставится на ПЕРВОЙ строке записи: у многострочных
       названий он иначе повисал бы рядом с коротким хвостом переноса.
       Точки-лидеры рисуются только для однострочных записей. */
    const firstLine = entry.lines[0];
    doc.font(FONT.sans).fontSize(style.tocSize).fillColor('#6B6872');
    const numStr = String(pageNum);
    const nw = doc.widthOfString(numStr);
    const numX = geom.contentX + geom.contentW - nw;
    doc.text(numStr, numX, y, { lineBreak: false });

    if (entry.lines.length === 1) {
      const dotsFrom = geom.contentX + (firstLine ? firstLine.naturalWidth : 0) + 4;
      const dotsTo = numX - 4;
      if (dotsTo - dotsFrom > 8) {
        doc.save();
        doc.lineWidth(0.5).strokeColor('#D5D2DA').dash(0.8, { space: 2.6 });
        doc.moveTo(dotsFrom, y + style.tocSize * 0.72).lineTo(dotsTo, y + style.tocSize * 0.72).stroke();
        doc.undash();
        doc.restore();
      }
    }

    // Вся запись кликабельна и ведёт на страницу раздела
    const h = entry.lines.length * tocLineStep;
    doc.goTo(geom.contentX, y - 1, geom.contentW, h + 2, `dest_${entry.chapter.id}`);
  }
}

function drawTranslationPage(doc, book, geom, style, ctx) {
  let y = geom.contentY + mm(18);

  doc.font(FONT.serifB).fontSize(16).fillColor(style.textColor);
  const t = book.team;
  const tw = doc.widthOfString(t);
  doc.text(t, geom.contentX + (geom.contentW - tw) / 2, y, { lineBreak: false });
  y += 16 * 1.4 + mm(3);

  doc.lineWidth(0.6).strokeColor(style.accent);
  doc.moveTo(geom.pageW / 2 - mm(9), y).lineTo(geom.pageW / 2 + mm(9), y).stroke();
  y += mm(6);

  const para = (text, font, size, color) => {
    const lines = layoutText(tokenize([{ text }], font === FONT.sans ? 'sans' : 'serif'), {
      width: geom.contentW,
      size,
      firstIndent: 0,
      justify: false,
      hyphenate: false,
      align: 'center',
      measure: ctx.measure,
    });
    for (const line of lines) {
      drawLine(doc, line, geom.contentX, y, size, color, ctx);
      y += size * 1.45;
    }
  };

  para(`Перевод выполнен командой «${book.team}».`, FONT.serif, 11, style.textColor);
  y += mm(4);
  para('Официальная страница команды:', FONT.sans, 9.5, '#6B6872');
  y += mm(1);

  // URL целиком — настоящая ссылка
  doc.font(FONT.sans).fontSize(9).fillColor(style.accent);
  const url = book.teamUrl;
  const urlLines = wrapUrl(doc, url, geom.contentW);
  for (const chunk of urlLines) {
    const w = doc.widthOfString(chunk);
    const x = geom.contentX + (geom.contentW - w) / 2;
    doc.text(chunk, x, y, { lineBreak: false });
    doc.link(x, y - 1, w, 11, url);
    y += 12;
  }
}

function wrapUrl(doc, url, maxW) {
  if (doc.widthOfString(url) <= maxW) return [url];
  const parts = [];
  let cur = '';
  for (const ch of url) {
    if (doc.widthOfString(cur + ch) > maxW) {
      parts.push(cur);
      cur = ch;
    } else {
      cur += ch;
    }
  }
  if (cur) parts.push(cur);
  return parts;
}

function drawPlainFolio(doc, pageNumber, ctx) {
  const { geom, style } = ctx;
  const y = geom.pageH - geom.bottom + (geom.bottom - style.folioSize) / 2 - 1;
  doc.font(FONT.sans).fontSize(style.folioSize).fillColor('#8A8A8A');
  const label = String(pageNumber);
  const w = doc.widthOfString(label);
  doc.text(label, geom.contentX + (geom.contentW - w) / 2, y, { lineBreak: false });
}

module.exports = { buildPdf, fmtNumber, plural };

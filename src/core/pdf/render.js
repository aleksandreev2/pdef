'use strict';

const { FONT } = require('./typeset');
const { drawOpenerMark, drawSceneBreak, drawSourceBreak } = require('../signature');

/**
 * Отрисовка подготовленных страниц.
 * Строка рисуется одним вызовом text() на сегмент одинакового формата:
 * разница ширины пробелов при выключке задаётся через wordSpacing,
 * так что текст остаётся настоящим текстом — выделяемым и копируемым.
 */

/** Сегменты строки с одинаковым начертанием/оформлением. */
function segments(line) {
  const out = [];
  for (const w of line.items) {
    const key = `${w.fontKey}|${w.fmt && w.fmt.u ? 1 : 0}|${(w.fmt && w.fmt.link) || ''}`;
    const prev = out[out.length - 1];
    if (prev && prev.key === key && prev.lastSpaceAfter) {
      prev.words.push(w);
      prev.lastSpaceAfter = w.spaceAfter;
    } else {
      out.push({ key, fontKey: w.fontKey, fmt: w.fmt || {}, words: [w], x: w.x, lastSpaceAfter: w.spaceAfter });
    }
  }
  return out;
}

function drawLine(doc, line, ox, y, size, color, ctx) {
  const normalSpace = ctx.measure(' ', FONT.serif, size);
  for (const seg of segments(line)) {
    const text = seg.words.map((w) => w.text).join(' ');
    doc.font(seg.fontKey).fontSize(size).fillColor(color);

    let wordSpacing = 0;
    if (seg.words.length > 1) {
      const natural = seg.words.reduce((a, b) => a + b.w, 0);
      const span = seg.words[seg.words.length - 1].x + seg.words[seg.words.length - 1].w - seg.words[0].x;
      const segSpace = ctx.measure(' ', seg.fontKey, size);
      const gaps = seg.words.length - 1;
      wordSpacing = (span - natural) / gaps - segSpace;
      if (!Number.isFinite(wordSpacing)) wordSpacing = 0;
    }

    // При lineBreak:false PDFKit не вычисляет textWidth/wordCount сам, а без них
    // ширина ссылок и подчёркивания становится NaN — передаём их явно.
    const opts = {
      lineBreak: false,
      wordSpacing,
      textWidth: ctx.measure(text, seg.fontKey, size),
      wordCount: seg.words.length,
    };
    if (seg.fmt.u) opts.underline = true;
    if (seg.fmt.link) opts.link = seg.fmt.link;
    doc.text(text, ox + seg.words[0].x, y, opts);
  }
}

function drawLinesPart(doc, part, ctx) {
  const { geom } = ctx;
  const ox = geom.contentX + (part.offsetX || 0);
  let y = part.y;
  for (const line of part.lines) {
    drawLine(doc, line, ox, y, part.size, part.color, ctx);
    y += part.lineStep;
  }
}

function drawSystemPart(doc, part, ctx) {
  const { geom, style } = ctx;
  const topPad = part.continued ? 0 : part.pad;
  const bottomPad = part.continuesOnNext ? 0 : part.pad;
  const boxH = part.lines.length * part.lineStep + topPad + bottomPad;
  const x = geom.contentX;
  const w = geom.contentW;

  doc.save();
  // Светлый нейтральный фон и тонкая рамка; при переносе рамка не замыкается.
  doc.roundedRect(x, part.y, w, boxH, part.continued || part.continuesOnNext ? 0 : 2.2)
    .fillColor(style.systemBg)
    .fill();
  doc.lineWidth(0.5).strokeColor(style.systemBorder);
  doc.moveTo(x, part.y).lineTo(x + w, part.y);
  if (!part.continued) doc.stroke();
  else doc.stroke(); // верхняя линия продолжения — та же тонкая черта

  doc.moveTo(x, part.y).lineTo(x, part.y + boxH).stroke();
  doc.moveTo(x + w, part.y).lineTo(x + w, part.y + boxH).stroke();
  if (!part.continuesOnNext) {
    doc.moveTo(x, part.y + boxH).lineTo(x + w, part.y + boxH).stroke();
  }
  doc.restore();

  let y = part.y + topPad;
  for (const line of part.lines) {
    if (line.items.length) {
      drawLine(doc, line, x + part.pad, y, part.size, ctx.style.textColor, ctx);
    }
    y += part.lineStep;
  }
}

function drawOpenerPart(doc, part, ctx) {
  const { geom, style } = ctx;
  let y = part.y;

  if (part.kicker) {
    doc.font(FONT.sansB).fontSize(style.kickerSize).fillColor(style.accent);
    doc.text(part.kicker, geom.contentX, y, { lineBreak: false, characterSpacing: 0.9 });
    y += style.kickerSize * 1.5;
  }
  if (style.signature) {
    y += drawOpenerMark(doc, geom.contentX, y, style.accent) * 0.6;
  }
  for (const line of part.titleLines) {
    drawLine(doc, line, geom.contentX, y, style.chapterTitleSize, style.textColor, ctx);
    y += part.titleStep;
  }
}

function drawSepPart(doc, part, ctx) {
  const { geom, style } = ctx;
  const cx = geom.contentX + geom.contentW / 2;
  if (part.fromSource && part.text) {
    drawSourceBreak(doc, cx, part.y, part.text, style.accent, FONT.serif, style.bodySize);
  } else {
    drawSceneBreak(doc, cx, part.y, style.accent);
  }
}

function drawImagePart(doc, part, ctx) {
  const asset = ctx.assets.get(part.assetId);
  if (!asset) return;
  try {
    doc.image(asset.data, part.x, part.y, { width: part.w, height: part.h });
  } catch (e) {
    ctx.warnings.push(`Иллюстрация ${part.assetId} не вставлена: ${e.message}`);
  }
}

/** Колонтитул: только номер страницы (бренд — опционально). */
function drawFolio(doc, pageNumber, ctx, page) {
  const { geom, style } = ctx;
  // Поверх важного изображения номер не ставим.
  const bigImage = page.parts.some((p) => p.t === 'image' && p.h > geom.contentH * 0.85);
  if (bigImage) return;

  const y = geom.pageH - geom.bottom + (geom.bottom - style.folioSize) / 2 - 1;
  doc.font(FONT.sans).fontSize(style.folioSize).fillColor('#8A8A8A');
  const label = String(pageNumber);
  const w = doc.widthOfString(label);
  doc.text(label, geom.contentX + (geom.contentW - w) / 2, y, { lineBreak: false });

  if (style.folioBrand) {
    doc.fontSize(style.folioSize - 0.6).fillColor('#B4B4B4');
    const brand = ctx.book.team;
    doc.text(brand, geom.contentX, y, { lineBreak: false });
  }
}

function renderPage(doc, page, pageNumber, ctx) {
  for (const part of page.parts) {
    switch (part.t) {
      case 'opener':
        drawOpenerPart(doc, part, ctx);
        break;
      case 'lines':
        drawLinesPart(doc, part, ctx);
        break;
      case 'system':
        drawSystemPart(doc, part, ctx);
        break;
      case 'sep':
        drawSepPart(doc, part, ctx);
        break;
      case 'image':
        drawImagePart(doc, part, ctx);
        break;
      default:
        break;
    }
  }
  drawFolio(doc, pageNumber, ctx, page);
}

module.exports = { renderPage, drawLine };

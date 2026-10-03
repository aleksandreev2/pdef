'use strict';

const { FONT } = require('./typeset');
const { drawOpenerMark, drawSceneBreak, drawPageFrame } = require('../signature');

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
    let x = ox + seg.words[0].x;
    for (const part of ctx.fontParts(text, seg.fontKey)) {
      // PDFKit при wordSpacing обрезает крайние пробелы. Их ширину
      // переносим в координаты, чтобы стык с дополнительным шрифтом не слипался.
      const leading = (part.text.match(/^ +/) || [''])[0];
      const drawText = part.text.trim();
      const textWidth = ctx.measure(part.text, part.fontKey, size);
      const startX = x + ctx.measure(leading, part.fontKey, size) + leading.length * wordSpacing;
      doc.font(part.fontKey).fontSize(size).fillColor(color);
      if (drawText) doc.text(drawText, startX, y, { ...opts,
        textWidth: ctx.measure(drawText, part.fontKey, size), wordCount: drawText.split(/ +/).length });
      x += textWidth + (part.text.match(/ /g) || []).length * wordSpacing;
    }
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
  doc.roundedRect(x, part.y, w, boxH, part.continued || part.continuesOnNext || style.panel !== 'rounded' ? 0 : 4)
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

  doc.save().strokeColor(style.accent).lineWidth(0.65);
  if (style.panel === 'angular') {
    doc.path(`M ${x} ${part.y+7} L ${x+7} ${part.y} L ${x+21} ${part.y} M ${x+w-21} ${part.y} L ${x+w-7} ${part.y} L ${x+w} ${part.y+7}`).stroke();
  } else {
    doc.path(`M ${x+5} ${part.y+4} L ${x+23} ${part.y+4} M ${x+w-23} ${part.y+4} L ${x+w-5} ${part.y+4}`).stroke();
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

  if (style.signature) {
    y += drawOpenerMark(doc, geom.pageW / 2, y, geom.contentW, style.accent, style.genre) + 5;
  }

  if (part.kicker) {
    doc.font(FONT.sansB).fontSize(style.kickerSize).fillColor(style.accent);
    const width = doc.widthOfString(part.kicker, { characterSpacing: 0.9 });
    doc.text(part.kicker, (geom.pageW-width)/2, y, { lineBreak: false, characterSpacing: 0.9 });
    y += style.kickerSize * 1.5 + 5;
  }
  for (const line of part.titleLines) {
    drawLine(doc, line, geom.contentX, y, style.chapterTitleSize, style.textColor, ctx);
    y += part.titleStep;
  }
}

function drawSepPart(doc, part, ctx) {
  const { geom, style } = ctx;
  const cx = geom.contentX + geom.contentW / 2;
  drawSceneBreak(doc, cx, part.y, style.accent, style.genre, Math.min(150, geom.contentW));
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
  if (style.signature) {
    doc.save().lineWidth(0.45).strokeColor(style.accent);
    const cx = geom.pageW / 2;
    doc.path(`M ${cx-30} ${y+4} L ${cx-12} ${y+4} M ${cx+12} ${y+4} L ${cx+30} ${y+4}`).stroke();
    doc.restore();
  }

  if (style.folioBrand) {
    doc.fontSize(style.folioSize - 0.6).fillColor('#B4B4B4');
    const brand = ctx.book.team;
    doc.text(brand, geom.contentX, y, { lineBreak: false });
  }
}

function renderPage(doc, page, pageNumber, ctx) {
  if (!page.parts.some(p => p.t === 'image')) drawPageFrame(doc, ctx.geom, ctx.style);
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

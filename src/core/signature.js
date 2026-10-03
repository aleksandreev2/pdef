'use strict';

/**
 * BOOK SIGNATURE (п.3 спецификации) — минималистичный мотив из линий,
 * точек и простой геометрии. Один и тот же рисунок в PDF и EPUB.
 * Поверх обложки и иллюстраций не используется.
 */

/* ──────────────────────────────── PDF ──────────────────────────────── */

/**
 * Крупный мотив для титульной страницы: тонкая ось, ромб и две точки.
 * @param {PDFDocument} doc
 * @param {number} cx центр по горизонтали
 * @param {number} y  верх мотива
 * @param {number} w  доступная ширина
 * @param {string} accent
 * @returns {number} высота отрисованного мотива
 */
function drawTitleMark(doc, cx, y, w, accent) {
  const span = Math.min(w * 0.52, 74);
  const r = 2.6;
  const half = span / 2;
  const midY = y + 7;

  doc.save();
  doc.lineWidth(0.6).strokeColor(accent).fillColor(accent);

  // Горизонтальная ось с разрывом под ромб
  doc.moveTo(cx - half, midY).lineTo(cx - 9, midY).stroke();
  doc.moveTo(cx + 9, midY).lineTo(cx + half, midY).stroke();

  // Ромб в центре
  doc
    .moveTo(cx, midY - 5)
    .lineTo(cx + 5, midY)
    .lineTo(cx, midY + 5)
    .lineTo(cx - 5, midY)
    .closePath()
    .lineWidth(0.7)
    .stroke();

  // Точки на концах
  doc.circle(cx - half - 3.4, midY, r * 0.5).fill();
  doc.circle(cx + half + 3.4, midY, r * 0.5).fill();

  // Нижняя короткая черта
  doc.lineWidth(0.5).moveTo(cx - 16, midY + 10).lineTo(cx + 16, midY + 10).stroke();

  doc.restore();
  return 22;
}

/**
 * Компактная метка в opener главы: короткая линия с точкой.
 * @returns {number} высота
 */
function drawOpenerMark(doc, x, y, accent) {
  doc.save();
  doc.lineWidth(0.7).strokeColor(accent).fillColor(accent);
  doc.moveTo(x, y + 3).lineTo(x + 19, y + 3).stroke();
  doc.circle(x + 23.5, y + 3, 1.2).fill();
  doc.restore();
  return 7;
}

/**
 * Сценический разделитель — используется ТОЛЬКО если в исходнике
 * нет собственного разделителя.
 * @returns {number} высота
 */
function drawSceneBreak(doc, cx, y, accent) {
  doc.save();
  doc.fillColor(accent).strokeColor(accent).lineWidth(0.5);
  doc.circle(cx - 9, y + 4, 1.1).fill();
  doc.circle(cx, y + 4, 1.5).fill();
  doc.circle(cx + 9, y + 4, 1.1).fill();
  doc.restore();
  return 9;
}

/** Текстовый разделитель из исходника, набранный акцентом. */
function drawSourceBreak(doc, cx, y, text, accent, fontKey, size) {
  doc.save();
  doc.font(fontKey).fontSize(size).fillColor(accent);
  const w = doc.widthOfString(text);
  doc.text(text, cx - w / 2, y, { lineBreak: false });
  doc.restore();
  return size * 1.2;
}

/* ─────────────────────────────── EPUB ─────────────────────────────── */

/** Тот же мотив в SVG — для титульной страницы EPUB. */
function svgTitleMark(accent) {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 32" width="120" height="32"',
    ' role="img" aria-label="Книжный знак">',
    `<g fill="none" stroke="${accent}" stroke-width="0.9">`,
    '<path d="M12 12 H49"/>',
    '<path d="M71 12 H108"/>',
    '<path d="M60 6 L66 12 L60 18 L54 12 Z"/>',
    '<path d="M44 24 H76" stroke-width="0.7"/>',
    '</g>',
    `<g fill="${accent}">`,
    '<circle cx="7" cy="12" r="1.6"/>',
    '<circle cx="113" cy="12" r="1.6"/>',
    '</g>',
    '</svg>',
  ].join('');
}

/** Сценический разделитель в SVG — для EPUB. */
function svgSceneBreak(accent) {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 10" width="48" height="10" role="presentation">',
    `<g fill="${accent}">`,
    '<circle cx="12" cy="5" r="1.5"/>',
    '<circle cx="24" cy="5" r="2"/>',
    '<circle cx="36" cy="5" r="1.5"/>',
    '</g>',
    '</svg>',
  ].join('');
}

module.exports = {
  drawTitleMark,
  drawOpenerMark,
  drawSceneBreak,
  drawSourceBreak,
  svgTitleMark,
  svgSceneBreak,
};

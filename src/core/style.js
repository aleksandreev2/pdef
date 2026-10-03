'use strict';

/** 1 мм в типографских пунктах. */
const MM = 72 / 25.4; // ≈ 2.834645669

const mm = (v) => v * MM;

/**
 * STYLE PROFILE (п.3 спецификации) — выбирается один раз и применяется
 * ко всей книге без изменений между главами.
 */
const DEFAULT_STYLE = {
  // Страница: 108 × 192 мм, вертикальная, 9:16
  pageWidthMm: 108,
  pageHeightMm: 192,

  // Поля: слева/справа 9–11 мм, сверху 10–12 мм, снизу 12–15 мм
  marginLeftMm: 10,
  marginRightMm: 10,
  marginTopMm: 11,
  marginBottomMm: 13.5,

  // Шрифты
  serif: 'auto', // основной (PT Serif или качественный кириллический serif)
  sans: 'auto', // служебный (PT Sans или совместимый sans-serif)

  // Основной текст: 11.2–12 pt, интерлиньяж 1.42–1.50
  bodySize: 11.5,
  lineHeight: 1.46,
  paragraphIndentMm: 4.5,
  justify: true,
  hyphenate: true,

  textColor: '#141414', // почти чёрный
  accent: '#6E5A7B', // спокойный цвет; переопределяется цветом из обложки

  // Opener главы
  kickerSize: 8.5, // номер главы: 8–9 pt
  chapterTitleSize: 17.5, // название: 16–19 pt
  openerGapMm: 7.5, // отступ до текста: 6–9 мм

  // Системные блоки: sans-serif 9.5–10.5 pt
  systemSize: 10,
  systemLineHeight: 1.34,
  systemPadMm: 3,
  systemBg: '#F4F2F6',
  systemBorder: '#D8D2DF',

  // Оглавление: 9.5–10.5 pt
  tocSize: 10,

  // Колонтитул: номер страницы 7.5–8.5 pt
  folioSize: 8,
  folioBrand: false,

  signature: true, // BOOK SIGNATURE
  dropCaps: false,
  widowControl: true,
};

/** Допустимые диапазоны из спецификации — UI не даёт выйти за них. */
const LIMITS = {
  bodySize: [11.2, 12],
  lineHeight: [1.42, 1.5],
  marginLeftMm: [9, 11],
  marginRightMm: [9, 11],
  marginTopMm: [10, 12],
  marginBottomMm: [12, 15],
  paragraphIndentMm: [4, 5],
  kickerSize: [8, 9],
  chapterTitleSize: [16, 19],
  openerGapMm: [6, 9],
  systemSize: [9.5, 12],
  tocSize: [9.5, 10.5],
  folioSize: [7.5, 8.5],
};

function clampStyle(style) {
  const out = { ...DEFAULT_STYLE, ...(style || {}) };
  for (const [key, [lo, hi]] of Object.entries(LIMITS)) {
    const v = Number(out[key]);
    out[key] = Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : DEFAULT_STYLE[key];
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(out.accent)) out.accent = DEFAULT_STYLE.accent;
  if (!/^#[0-9a-fA-F]{6}$/.test(out.textColor)) out.textColor = DEFAULT_STYLE.textColor;
  return out;
}

/** Производная геометрия страницы в пунктах. */
function geometry(style) {
  const pageW = mm(style.pageWidthMm);
  const pageH = mm(style.pageHeightMm);
  const left = mm(style.marginLeftMm);
  const right = mm(style.marginRightMm);
  const top = mm(style.marginTopMm);
  const bottom = mm(style.marginBottomMm);
  return {
    pageW,
    pageH,
    left,
    right,
    top,
    bottom,
    contentW: pageW - left - right,
    contentH: pageH - top - bottom,
    contentX: left,
    contentY: top,
    contentBottom: pageH - bottom,
    lineGap: style.bodySize * (style.lineHeight - 1),
    lineStep: style.bodySize * style.lineHeight,
    indent: mm(style.paragraphIndentMm),
  };
}

module.exports = { DEFAULT_STYLE, LIMITS, clampStyle, geometry, mm, MM };

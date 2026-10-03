'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Поиск реальных файлов шрифтов для PDFKit.
 * Приоритет: assets/fonts рядом с приложением → системные кириллические
 * serif/sans. Семейство выбирается только если найдено regular-начертание.
 */

function fontDirs() {
  const dirs = [path.join(__dirname, '..', '..', 'assets', 'fonts')];
  if (process.platform === 'win32') {
    dirs.push(path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts'));
    if (process.env.LOCALAPPDATA) {
      dirs.push(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Fonts'));
    }
  } else if (process.platform === 'darwin') {
    dirs.push('/System/Library/Fonts', '/System/Library/Fonts/Supplemental', '/Library/Fonts', path.join(os.homedir(), 'Library', 'Fonts'));
  } else {
    dirs.push('/usr/share/fonts', '/usr/local/share/fonts', path.join(os.homedir(), '.fonts'), path.join(os.homedir(), '.local/share/fonts'));
  }
  return dirs.filter((d) => {
    try {
      return fs.statSync(d).isDirectory();
    } catch {
      return false;
    }
  });
}

/** Рекурсивный индекс шрифтов: имя файла в нижнем регистре → полный путь. */
let indexCache = null;
function fontIndex() {
  if (indexCache) return indexCache;
  const index = new Map();
  const walk = (dir, depth) => {
    if (depth > 3) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (/\.(ttf|otf)$/i.test(e.name)) {
        const key = e.name.toLowerCase();
        if (!index.has(key)) index.set(key, full);
      }
    }
  };
  for (const d of fontDirs()) walk(d, 0);
  indexCache = index;
  return index;
}

/** Семейства в порядке предпочтения: сначала PT, затем качественные кириллические. */
const SERIF_FAMILIES = [
  { name: 'PT Serif', files: ['ptserif-regular.ttf', 'pt_serif-web-regular.ttf', 'ptf55f.ttf', 'ptserif.ttf'], bold: ['ptserif-bold.ttf', 'pt_serif-web-bold.ttf', 'ptf75f.ttf'], italic: ['ptserif-italic.ttf', 'pt_serif-web-italic.ttf', 'ptf56f.ttf'], boldItalic: ['ptserif-bolditalic.ttf', 'pt_serif-web-bolditalic.ttf', 'ptf76f.ttf'] },
  { name: 'Charter', files: ['charter_regular.ttf', 'charter.ttf'], bold: ['charter_bold.ttf'], italic: ['charter_italic.ttf'], boldItalic: ['charter_bold_italic.ttf'] },
  { name: 'Georgia', files: ['georgia.ttf'], bold: ['georgiab.ttf'], italic: ['georgiai.ttf'], boldItalic: ['georgiaz.ttf'] },
  { name: 'Constantia', files: ['constan.ttf'], bold: ['constanb.ttf'], italic: ['constani.ttf'], boldItalic: ['constanz.ttf'] },
  { name: 'DejaVu Serif', files: ['dejavuserif.ttf'], bold: ['dejavuserif-bold.ttf'], italic: ['dejavuserif-italic.ttf'], boldItalic: ['dejavuserif-bolditalic.ttf'] },
  { name: 'Liberation Serif', files: ['liberationserif-regular.ttf'], bold: ['liberationserif-bold.ttf'], italic: ['liberationserif-italic.ttf'], boldItalic: ['liberationserif-bolditalic.ttf'] },
  { name: 'Times New Roman', files: ['times.ttf'], bold: ['timesbd.ttf'], italic: ['timesi.ttf'], boldItalic: ['timesbi.ttf'] },
];

const SANS_FAMILIES = [
  { name: 'PT Sans', files: ['ptsans-regular.ttf', 'pt_sans-web-regular.ttf', 'pts55f.ttf', 'ptsans.ttf'], bold: ['ptsans-bold.ttf', 'pt_sans-web-bold.ttf', 'pts75f.ttf'], italic: ['ptsans-italic.ttf', 'pt_sans-web-italic.ttf', 'pts56f.ttf'], boldItalic: ['ptsans-bolditalic.ttf', 'pts76f.ttf'] },
  { name: 'Segoe UI', files: ['segoeui.ttf'], bold: ['segoeuib.ttf'], italic: ['segoeuii.ttf'], boldItalic: ['segoeuiz.ttf'] },
  { name: 'Tahoma', files: ['tahoma.ttf'], bold: ['tahomabd.ttf'], italic: [], boldItalic: [] },
  { name: 'DejaVu Sans', files: ['dejavusans.ttf'], bold: ['dejavusans-bold.ttf'], italic: ['dejavusans-oblique.ttf'], boldItalic: ['dejavusans-boldoblique.ttf'] },
  { name: 'Liberation Sans', files: ['liberationsans-regular.ttf'], bold: ['liberationsans-bold.ttf'], italic: ['liberationsans-italic.ttf'], boldItalic: ['liberationsans-bolditalic.ttf'] },
  { name: 'Arial', files: ['arial.ttf'], bold: ['arialbd.ttf'], italic: ['ariali.ttf'], boldItalic: ['arialbi.ttf'] },
];

function pick(index, names) {
  for (const n of names || []) {
    const hit = index.get(n.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

function resolveFamily(families, wanted) {
  const index = fontIndex();
  const ordered =
    wanted && wanted !== 'auto'
      ? [...families.filter((f) => f.name.toLowerCase() === String(wanted).toLowerCase()), ...families]
      : families;

  for (const fam of ordered) {
    const regular = pick(index, fam.files);
    if (!regular) continue;
    return {
      name: fam.name,
      regular,
      bold: pick(index, fam.bold) || regular,
      italic: pick(index, fam.italic) || regular,
      boldItalic: pick(index, fam.boldItalic) || pick(index, fam.bold) || regular,
      synthetic: {
        bold: !pick(index, fam.bold),
        italic: !pick(index, fam.italic),
      },
    };
  }
  return null;
}

/** @returns {{serif:object, sans:object, warnings:string[]}} */
function resolveFonts(style = {}) {
  const warnings = [];
  const serif = resolveFamily(SERIF_FAMILIES, style.serif);
  const sans = resolveFamily(SANS_FAMILIES, style.sans);

  if (!serif) warnings.push('Не найден ни один serif-шрифт — положите PTSerif-Regular.ttf в assets/fonts');
  if (!sans) warnings.push('Не найден ни один sans-шрифт — положите PTSans-Regular.ttf в assets/fonts');
  if (serif && serif.name !== 'PT Serif') {
    warnings.push(`PT Serif не установлен, основной шрифт: ${serif.name} (положите PTSerif-*.ttf в assets/fonts или запустите npm run fonts)`);
  }
  if (sans && sans.name !== 'PT Sans') {
    warnings.push(`PT Sans не установлен, служебный шрифт: ${sans.name}`);
  }
  if (serif && serif.synthetic.italic) warnings.push(`У ${serif.name} нет курсивного начертания — курсив будет заменён прямым`);

  return { serif, sans, warnings };
}

/** Список доступных семейств для выпадающих списков в UI. */
function availableFamilies() {
  const index = fontIndex();
  const has = (fam) => !!pick(index, fam.files);
  return {
    serif: SERIF_FAMILIES.filter(has).map((f) => f.name),
    sans: SANS_FAMILIES.filter(has).map((f) => f.name),
  };
}

module.exports = { resolveFonts, availableFamilies };

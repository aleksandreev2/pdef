'use strict';

const { runsText } = require('../model');
const { trimPara } = require('./normalize');
const { isTitleRepeat, parseHeading } = require('./titles');

/**
 * Сборка блоков из «сырых параграфов» импортёра.
 *
 * Сырой параграф: { runs:[Run], style?:string, align?:string,
 *                   list?:{ordered:boolean,level:number}, image?:{assetId,alt,w,h} }
 */

/** Сценический разделитель целиком из декоративных символов. */
const SEP_RE = /^[\s*\-–—=_~·•◆◇※#.·]{2,}$/u;

/** Строка системного окна/чата/панели. */
function isSystemLine(text) {
  const t = text.trim();
  if (t.length < 2) return false;
  if (t.length > 1200) return false;
  // [ ... ]  /  【 ... 】  /  《 ... 》
  if (/^\[.*\]$/s.test(t)) return true;
  if (/^【.*】$/s.test(t)) return true;
  if (/^《.*》$/s.test(t)) return true;
  // Незакрытая скобка в многострочном окне: «[Системное окно» … «уровень +1]»
  if (/^\[[^\]]*$/s.test(t)) return true;
  return false;
}

/** Снятие внешних скобок у строки системного блока. */
function stripSystemBrackets(runs) {
  if (!runs.length) return runs;
  const out = runs.map((r) => ({ ...r }));
  const first = out[0];
  const last = out[out.length - 1];
  const open = first.text.match(/^\s*([\[【《])/);
  if (!open) return out;
  const closeMap = { '[': ']', '【': '】', '《': '》' };
  const close = closeMap[open[1]];
  if (!last.text.trimEnd().endsWith(close)) return out;
  first.text = first.text.replace(/^\s*[\[【《]/, '');
  last.text = last.text.replace(new RegExp(`\\${close}\\s*$`), '');
  return out.filter((r) => r.text.length > 0 || out.length === 1);
}

function isHeadingStyle(style) {
  return /^(Heading[1-6]|Title|Subtitle|Заголовок)/i.test(style || '');
}

/**
 * @param {Array} rawParas
 * @param {{kind:string, number:number|null, title:string}} section
 * @returns {{blocks:Array, droppedTitle:boolean}}
 */
function buildBlocks(rawParas, section) {
  const cleaned = [];

  for (const p of rawParas) {
    if (p.image) {
      cleaned.push({ kind: 'image', image: p.image });
      continue;
    }
    if (p.table) {
      // Таблица из исходника — готовый структурный блок, в прозу не превращаем.
      cleaned.push({ kind: 'table', lines: p.lines });
      continue;
    }
    const runs = (p.runs || [])
      .map((r) => ({ ...r, text: trimPara(r.text) === '' ? r.text.replace(/\s+/g, ' ') : r.text }))
      .map((r) => ({ ...r, text: r.text.replace(/\s+/g, ' ') }));
    const text = trimPara(runsText(runs));
    if (!text) continue; // пустые параграфы экспорта — технический мусор
    cleaned.push({
      kind: 'text',
      text,
      runs: compactRuns(runs, text),
      style: p.style,
      align: p.align,
      list: p.list,
    });
  }

  // Повтор заголовка в первом текстовом параграфе: убираем его из текста и
  // забираем название оттуда — в документе пунктуация точнее, чем в имени
  // файла, где «?» и «:» заменены файловой системой на подчёркивание.
  let droppedTitle = false;
  let headingFromText = null;
  const firstText = cleaned.find((c) => c.kind === 'text');
  if (firstText && isTitleRepeat(firstText.text, section)) {
    headingFromText = parseHeading(firstText.text);
    cleaned.splice(cleaned.indexOf(firstText), 1);
    droppedTitle = true;
  }

  const blocks = [];
  let i = 0;
  while (i < cleaned.length) {
    const item = cleaned[i];

    if (item.kind === 'image') {
      blocks.push({ type: 'image', ...item.image });
      i += 1;
      continue;
    }

    if (item.kind === 'table') {
      blocks.push({ type: 'system', lines: item.lines, table: true });
      i += 1;
      continue;
    }

    if (SEP_RE.test(item.text)) {
      blocks.push({ type: 'sep', text: item.text });
      i += 1;
      continue;
    }

    if (isSystemLine(item.text)) {
      // Подряд идущие системные строки — один неразрушаемый блок.
      const lines = [];
      while (i < cleaned.length && cleaned[i].kind === 'text' && isSystemLine(cleaned[i].text)) {
        lines.push(stripSystemBrackets(cleaned[i].runs));
        i += 1;
      }
      blocks.push({ type: 'system', lines });
      continue;
    }

    if (item.list) {
      const items = [];
      const ordered = !!item.list.ordered;
      while (i < cleaned.length && cleaned[i].kind === 'text' && cleaned[i].list && !!cleaned[i].list.ordered === ordered) {
        items.push(cleaned[i].runs);
        i += 1;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    if (isHeadingStyle(item.style)) {
      blocks.push({ type: 'heading', level: 2, runs: item.runs });
      i += 1;
      continue;
    }

    blocks.push({
      type: 'para',
      runs: item.runs,
      align: item.align && item.align !== 'both' ? item.align : undefined,
    });
    i += 1;
  }

  return { blocks, droppedTitle, headingFromText };
}

/** Склейка соседних run'ов с одинаковым форматированием. */
function compactRuns(runs, fallbackText) {
  const out = [];
  for (const r of runs) {
    if (!r.text) continue;
    const prev = out[out.length - 1];
    if (prev && !!prev.b === !!r.b && !!prev.i === !!r.i && !!prev.u === !!r.u && prev.link === r.link) {
      prev.text += r.text;
    } else {
      out.push({ ...r });
    }
  }
  if (!out.length && fallbackText) out.push({ text: fallbackText });
  if (out.length) {
    out[0].text = out[0].text.replace(/^[  ]+/, '');
    out[out.length - 1].text = out[out.length - 1].text.replace(/[  ]+$/, '');
  }
  return out.filter((r) => r.text.length > 0);
}

module.exports = { buildBlocks, isSystemLine, SEP_RE };

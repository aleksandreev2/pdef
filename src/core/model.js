'use strict';

/**
 * Единое внутреннее представление книги (IR).
 * Исходники разбираются ОДИН раз в эту структуру, после чего из неё
 * собираются и PDF, и EPUB. См. п.0 спецификации PDFMAKER MOBILE v3 FAST.
 *
 * Блоки:
 *   { type:'para',    runs:[Run], align?:'left'|'center'|'right'|'justify' }
 *   { type:'heading', level:1|2|3, runs:[Run] }
 *   { type:'system',  lines:[[Run]] }     — системное окно/чат/панель (неразрушаемый блок)
 *   { type:'sep',     text?:string }      — сценический разделитель из исходника
 *   { type:'image',   assetId, alt, w, h }
 *   { type:'list',    ordered:boolean, items:[[Run]] }
 *
 * Run: { text:string, b?:boolean, i?:boolean, u?:boolean, link?:string }
 */

const KIND = {
  COVER_GALLERY: 'illustrations',
  PROLOGUE: 'prologue',
  CHAPTER: 'chapter',
  EPILOGUE: 'epilogue',
  AFTERWORD: 'afterword',
  EXTRA: 'extra',
};

/** Порядок сортировки разделов по типу, когда номера главы нет. */
const KIND_ORDER = {
  [KIND.COVER_GALLERY]: 0,
  [KIND.PROLOGUE]: 1,
  [KIND.CHAPTER]: 2,
  [KIND.EPILOGUE]: 3,
  [KIND.AFTERWORD]: 4,
  [KIND.EXTRA]: 5,
};

function makeRun(text, fmt = {}) {
  const run = { text };
  if (fmt.b) run.b = true;
  if (fmt.i) run.i = true;
  if (fmt.u) run.u = true;
  if (fmt.link) run.link = fmt.link;
  return run;
}

function runsText(runs) {
  return (runs || []).map((r) => r.text).join('');
}

function blockText(block) {
  switch (block.type) {
    case 'para':
    case 'heading':
      return runsText(block.runs);
    case 'system':
      return block.lines.map(runsText).join('\n');
    case 'list':
      return block.items.map(runsText).join('\n');
    case 'sep':
      return block.text || '';
    default:
      return '';
  }
}

/** Текст, который идёт в подсчёт статистики как «основной текст». */
function bodyText(block) {
  if (block.type === 'heading' || block.type === 'image' || block.type === 'sep') return '';
  return blockText(block);
}

function makeChapter(init) {
  return {
    id: init.id,
    sourceFile: init.sourceFile || '',
    sourceName: init.sourceName || '',
    kind: init.kind || KIND.CHAPTER,
    number: init.number === undefined ? null : init.number,
    title: init.title || '',
    blocks: init.blocks || [],
    include: init.include !== false,
    issues: init.issues || [],
    encoding: init.encoding || null,
    // заполняется stats.js
    words: 0,
    wordsWithHeadings: 0,
    charsWithSpaces: 0,
    charsNoSpaces: 0,
    images: 0,
    systemBlocks: 0,
  };
}

function makeBook() {
  return {
    title: '',
    subtitle: 'Полное издание',
    team: 'Дом Некроманта',
    teamUrl: 'https://ranobelib.me/ru/team/11969--dom-nekromanta',
    language: 'ru',
    cover: null, // { assetId, ext, w, h }
    assets: new Map(), // assetId -> { ext, mime, data:Buffer, w, h }
    chapters: [],
    audit: null,
    stats: null,
  };
}

/** Человеческая подпись раздела для оглавления и закладок. */
function chapterLabel(ch) {
  const num = ch.number === null ? null : String(ch.number).padStart(3, '0');
  switch (ch.kind) {
    case KIND.PROLOGUE:
      return ch.title ? `Пролог. ${ch.title}` : 'Пролог';
    case KIND.EPILOGUE:
      return ch.title ? `Эпилог. ${ch.title}` : 'Эпилог';
    case KIND.AFTERWORD:
      return ch.title ? `Послесловие автора. ${ch.title}` : 'Послесловие автора';
    case KIND.COVER_GALLERY:
      return ch.title || 'Иллюстрации';
    case KIND.EXTRA:
      return ch.title || 'Дополнительно';
    default:
      if (num && ch.title) return `${num}. ${ch.title}`;
      if (num) return num;
      return ch.title || 'Без названия';
  }
}

/** Короткий номер для opener главы («Глава 014», «Пролог», …). */
function chapterKicker(ch) {
  switch (ch.kind) {
    case KIND.PROLOGUE:
      return 'ПРОЛОГ';
    case KIND.EPILOGUE:
      return 'ЭПИЛОГ';
    case KIND.AFTERWORD:
      return 'ПОСЛЕСЛОВИЕ АВТОРА';
    case KIND.COVER_GALLERY:
      return 'ИЛЛЮСТРАЦИИ';
    case KIND.EXTRA:
      return 'ДОПОЛНИТЕЛЬНО';
    default:
      return ch.number === null ? '' : `ГЛАВА ${String(ch.number).padStart(3, '0')}`;
  }
}

module.exports = {
  KIND,
  KIND_ORDER,
  makeRun,
  makeChapter,
  makeBook,
  runsText,
  blockText,
  bodyText,
  chapterLabel,
  chapterKicker,
};

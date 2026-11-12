'use strict';

const { KIND } = require('../model');

/** Разделители «номер — название» во всех встречающихся вариантах. */
const DASH = '[—–‒―\\-]';

/* \b в JS опирается на латиницу, поэтому после кириллического слова он не
   срабатывает — границу задаём явно через отсутствие следующей буквы. */
const EOW = '(?![\\p{L}\\p{N}])';
const GALLERY_WORDS = 'иллюстрации|иллюстрация|illustrations?|арты|арт|gallery';
const GALLERY_LABEL = new RegExp(`^(?:${GALLERY_WORDS})[.!?…]*$`, 'iu');

const KIND_WORDS = [
  { re: new RegExp(`^(пролог|prologue)${EOW}`, 'iu'), kind: KIND.PROLOGUE },
  { re: new RegExp(`^(эпилог|epilogue)${EOW}`, 'iu'), kind: KIND.EPILOGUE },
  {
    re: new RegExp(`^(послесловие(\\s+автора)?|afterword|author'?s?\\s+note)${EOW}`, 'iu'),
    kind: KIND.AFTERWORD,
  },
  {
    re: new RegExp(`^(?:${GALLERY_WORDS})${EOW}`, 'iu'),
    kind: KIND.COVER_GALLERY,
  },
  { re: new RegExp(`^(экстра|бонус|extra|bonus|side\\s*story|спешл)${EOW}`, 'iu'), kind: KIND.EXTRA },
];

/** Ключевое слово раздела в названии: «Глава 0. Иллюстрации» — это галерея. */
function kindFromTitle(title) {
  for (const { re, kind } of KIND_WORDS) {
    if (re.test(String(title || '').trim())) return kind;
  }
  return null;
}

function isGalleryLabel(text) {
  return GALLERY_LABEL.test(text.trim());
}

function numberedHeading(number, text) {
  const title = text.trim();
  const kind = kindFromTitle(title);
  return Number(number) === 0 && kind === KIND.COVER_GALLERY
    ? { kind, number: null, title }
    : { kind: KIND.CHAPTER, number: Number(number), title };
}

function stripExt(name) {
  return name.replace(/\.[A-Za-z0-9]{1,5}$/, '');
}

/** Восстановление символов, заменённых файловой системой: `_` вместо `?`, `:` и т.п. */
function restoreFilenameChars(s) {
  // Google Drive / Windows заменяют ? : " * | на подчёркивание.
  return s.replace(/_(\.|$)/g, '?$1').replace(/_!/g, '?!').replace(/_\?/g, '?');
}

/**
 * Разбор «NNN — Название» / «Глава 12. Название» / «Пролог — …» / «012».
 * Возвращает { kind, number, title } либо null, если ничего не распознано.
 */
function parseHeading(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s) return null;

  // Ведущий маркер заголовка из экспорта: «#000. Название»
  s = s.replace(/^#{1,6}\s*/, '');
  // «48-я глава. Название» встречается в исходниках WORKING.
  s = s.replace(/^(\d{1,4})[-‑–]?(?:я|ая)\s+глава\s*[.:]?\s*/iu, 'Глава $1. ');

  // Явный тип раздела словом.
  for (const { re, kind } of KIND_WORDS) {
    const m = s.match(re);
    if (m) {
      const rest = s.slice(m[0].length).replace(new RegExp(`^\\s*(${DASH}|[.:·])\\s*`), '').trim();
      return { kind, number: null, title: rest };
    }
  }

  // «Глава 12. Название» / «Chapter 12 — Название» / «Том 1 Глава 5»
  let m = s.match(new RegExp(`^(?:глава|chapter|ch\\.?|часть|гл\\.?)\\s*(?:№\\s*)?(\\d{1,4})(?!\\d)\\s*(?:[.:·]|${DASH})?\\s*(.*)$`, 'i'));
  if (m) return numberedHeading(m[1], m[2]);

  // «000 — Название» / «001. Название» / «12) Название»
  m = s.match(new RegExp(`^(\\d{1,4})\\s*(?:[.:·)\\]]|${DASH})\\s*(.*)$`));
  if (m) return numberedHeading(m[1], m[2]);

  // Только номер: «000», «012»
  m = s.match(/^(\d{1,4})$/);
  if (m) return { kind: KIND.CHAPTER, number: Number(m[1]), title: '' };

  return null;
}

/** Infer weak number-only or space-separated labels from nearby native siblings. */
function inferNativeNumbers(parts) {
  const numbered = new Map();
  const groups = new Map();
  for (const [index, part] of parts.entries()) {
    if (!part.nativeTitle || part.kind) continue;
    const weak = part.title.match(/^(\d{1,4})(?:\s+(\S.*))?$/su);
    const parsed = weak ? numberedHeading(weak[1], weak[2] || '') : parseHeading(part.title);
    if (parsed?.number == null) continue;
    if (!groups.has(part.siblingGroup)) groups.set(part.siblingGroup, new Map());
    const siblings = groups.get(part.siblingGroup);
    let previous = null;
    for (let step = 1; step <= 3; step += 1) {
      const candidate = siblings.get(parsed.number - step);
      if (candidate && index - candidate.index <= 5 &&
          (!previous || candidate.length > previous.length)) previous = candidate;
    }
    const consecutive = (previous?.consecutive || 0) + (previous?.number === parsed.number - 1 ? 1 : 0);
    const node = { index, number: parsed.number, parsed, weak: !!weak, previous, length: (previous?.length || 0) + 1, consecutive };
    siblings.set(parsed.number, node);
    if (node.length >= 3 && consecutive >= 2) {
      for (let entry = node; entry && !entry.confirmed; entry = entry.previous) {
        if (entry.weak) numbered.set(entry.index, entry.parsed);
        entry.confirmed = true;
      }
    }
  }
  return numbered;
}

/**
 * Определение раздела по имени файла.
 * Имя файла — запасной источник до разбора явного заголовка документа.
 */
function fromFilename(filename) {
  const base = restoreFilenameChars(stripExt(filename));
  const parsed = parseHeading(base.replace(/_/g, ' '));
  if (parsed) return parsed;
  return { kind: KIND.CHAPTER, number: null, title: base.trim() };
}

/**
 * Совпадает ли первый параграф документа с заголовком раздела
 * (тогда это «случайный повтор заголовка» и его надо убрать из текста).
 */
function isTitleRepeat(paraText, section) {
  if (!paraText) return false;
  const t = paraText.trim();
  if (t.length > 200) return false;

  const parsed = parseHeading(t);
  if (!parsed) return false;

  const norm = (x) =>
    String(x || '')
      .toLowerCase()
      .replace(/[«»"'`.,:;!?…()\[\]]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  // Тот же номер — повтор, даже если название слегка отличается пунктуацией.
  if (parsed.number !== null && section.number !== null && parsed.number === section.number) return true;
  // Тот же тип раздела без номера (пролог/эпилог/послесловие).
  if (parsed.kind !== KIND.CHAPTER && parsed.kind === section.kind) return true;
  // Совпадение названий.
  if (parsed.title && norm(parsed.title) === norm(section.title)) return true;
  if (norm(t) === norm(section.title)) return true;

  return false;
}

module.exports = { parseHeading, inferNativeNumbers, fromFilename, isTitleRepeat, kindFromTitle, isGalleryLabel, stripExt, restoreFilenameChars };

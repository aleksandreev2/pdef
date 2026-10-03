'use strict';

const { KIND } = require('../model');

/** Разделители «номер — название» во всех встречающихся вариантах. */
const DASH = '[—–‒―\\-]';

/* \b в JS опирается на латиницу, поэтому после кириллического слова он не
   срабатывает — границу задаём явно через отсутствие следующей буквы. */
const EOW = '(?![\\p{L}\\p{N}])';

const KIND_WORDS = [
  { re: new RegExp(`^(пролог|prologue)${EOW}`, 'iu'), kind: KIND.PROLOGUE },
  { re: new RegExp(`^(эпилог|epilogue)${EOW}`, 'iu'), kind: KIND.EPILOGUE },
  {
    re: new RegExp(`^(послесловие(\\s+автора)?|afterword|author'?s?\\s+note)${EOW}`, 'iu'),
    kind: KIND.AFTERWORD,
  },
  {
    re: new RegExp(`^(иллюстрации|иллюстрация|illustrations?|арты|арт|gallery)${EOW}`, 'iu'),
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
  s = s.replace(/^#\s*/, '');

  // Явный тип раздела словом.
  for (const { re, kind } of KIND_WORDS) {
    const m = s.match(re);
    if (m) {
      const rest = s.slice(m[0].length).replace(new RegExp(`^\\s*(${DASH}|[.:·])\\s*`), '').trim();
      return { kind, number: null, title: rest };
    }
  }

  // «Глава 12. Название» / «Chapter 12 — Название» / «Том 1 Глава 5»
  let m = s.match(new RegExp(`^(?:глава|chapter|ch\\.?|часть|гл\\.?)\\s*(\\d{1,4})\\s*(?:[.:·]|${DASH})?\\s*(.*)$`, 'i'));
  if (m) {
    const title = m[2].trim();
    // «Глава 0. Иллюстрации» — это галерея, а не глава с номером 0.
    const byTitle = kindFromTitle(title);
    if (byTitle) return { kind: byTitle, number: null, title };
    return { kind: KIND.CHAPTER, number: Number(m[1]), title };
  }

  // «000 — Название» / «001. Название» / «12) Название»
  m = s.match(new RegExp(`^(\\d{1,4})\\s*(?:[.:·)\\]]|${DASH})\\s*(.*)$`));
  if (m) return { kind: KIND.CHAPTER, number: Number(m[1]), title: m[2].trim() };

  // Только номер: «000», «012»
  m = s.match(/^(\d{1,4})$/);
  if (m) return { kind: KIND.CHAPTER, number: Number(m[1]), title: '' };

  return null;
}

/**
 * Определение раздела по имени файла.
 * Имя файла — первичный источник: именно оно задаёт порядок чтения.
 */
function fromFilename(filename) {
  const base = restoreFilenameChars(stripExt(filename));
  const parsed = parseHeading(base);
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

module.exports = { parseHeading, fromFilename, isTitleRepeat, kindFromTitle, stripExt, restoreFilenameChars };

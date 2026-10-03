'use strict';

/**
 * Нормализация ТОЛЬКО технических дефектов (п.2 спецификации).
 * Литературный текст, имена, термины, реплики и авторская пунктуация
 * не меняются.
 */

const SOFT_HYPHEN = /­/g;
const ZERO_WIDTH = /[​‌‍⁠﻿]/g;
// Управляющие символы, кроме \t и \n
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Технический мусор внутри одной строки. */
function cleanInline(text) {
  if (!text) return '';
  let s = text;
  s = s.replace(CONTROL, '');
  s = s.replace(SOFT_HYPHEN, '');
  s = s.replace(ZERO_WIDTH, '');
  s = s.replace(/\r\n?/g, '\n');
  // Табуляция в экспортах — просто пробел.
  s = s.replace(/\t/g, ' ');
  // Повторяющиеся обычные пробелы (NBSP сохраняем: он типографически значим).
  s = s.replace(/ {2,}/g, ' ');
  // Пробел перед закрывающей и после открывающей кавычки/скобки — артефакт экспорта.
  s = s.replace(/« +/g, '«').replace(/ +»/g, '»');
  // Пробел перед знаками препинания (кроме тире).
  s = s.replace(/ +([,;:!?…](?!\.))/g, '$1');
  return s;
}

/** Схлопывание пробелов по краям параграфа. */
function trimPara(text) {
  return cleanInline(text).replace(/^[  ]+|[  ]+$/g, '');
}

/**
 * Эвристика для TXT: текст с «жёсткими» переносами строк внутри абзаца
 * (результат конвертации) нужно склеить обратно в абзацы.
 * Возвращает true, если файл выглядит как hard-wrapped.
 */
function looksHardWrapped(lines) {
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  if (nonEmpty.length < 8) return false;

  const blankCount = lines.length - nonEmpty.length;
  // Если пустых строк много — абзацы уже разделены пустыми строками.
  if (blankCount >= nonEmpty.length * 0.4) return false;

  let continued = 0;
  let measured = 0;
  for (let i = 0; i < nonEmpty.length - 1; i += 1) {
    const cur = nonEmpty[i].trim();
    const next = nonEmpty[i + 1].trim();
    if (cur.length < 20) continue;
    measured += 1;
    const endsOpen = !/[.!?…:;»"»)\]]$/.test(cur);
    const nextLower = /^[a-zа-яё(]/.test(next);
    if (endsOpen && nextLower) continued += 1;
  }
  if (measured < 5) return false;
  return continued / measured > 0.3;
}

/** Склейка hard-wrapped строк в абзацы. */
function unwrapLines(lines) {
  const paras = [];
  let buf = '';
  const flush = () => {
    if (buf.trim()) paras.push(buf.trim());
    buf = '';
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    // Диалоги, системные блоки и разделители всегда начинают новый абзац.
    if (/^(—|–|-\s|\[|【|\*\s*\*|#)/.test(line) && buf) flush();
    buf = buf ? `${buf} ${line}` : line;
    // Конец абзаца — завершённое предложение + короткая строка (конец параграфа).
    if (/[.!?…»"]$/.test(line) && line.length < 40) flush();
  }
  flush();
  return paras;
}

module.exports = { cleanInline, trimPara, looksHardWrapped, unwrapLines };

'use strict';

const jschardet = require('jschardet');
const iconv = require('iconv-lite');
const { makeRun } = require('../model');
const { looksHardWrapped, unwrapLines, cleanInline } = require('../parse/normalize');

/** Кодировки, которые реально встречаются в русских TXT. */
const CANDIDATES = ['utf-8', 'windows-1251', 'koi8-r', 'ibm866', 'utf-16le', 'utf-16be'];

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Доля «подозрительных» символов — признак неверно угаданной кодировки. */
function mojibakeScore(text) {
  if (!text) return 1;
  const sample = text.slice(0, 20000);
  let bad = 0;
  for (const ch of sample) {
    const c = ch.codePointAt(0);
    if (c === 0xfffd) bad += 3; // U+FFFD
    else if (c >= 0x80 && c <= 0xbf) bad += 1; // одиночные байты latin-1
    else if (ch === 'Ð' || ch === 'Ñ' || ch === 'Â' || ch === '�') bad += 2;
  }
  return bad / sample.length;
}

/**
 * Декодирование с определением кодировки.
 * @returns {{text:string, encoding:string, guessConfidence:number}}
 */
function decodeText(buffer) {
  if (buffer.length >= 2) {
    if (buffer[0] === 0xff && buffer[1] === 0xfe) {
      return { text: stripBom(iconv.decode(buffer, 'utf-16le')), encoding: 'utf-16le', guessConfidence: 1 };
    }
    if (buffer[0] === 0xfe && buffer[1] === 0xff) {
      return { text: stripBom(iconv.decode(buffer, 'utf-16be')), encoding: 'utf-16be', guessConfidence: 1 };
    }
  }
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { text: stripBom(iconv.decode(buffer, 'utf-8')), encoding: 'utf-8 (BOM)', guessConfidence: 1 };
  }

  let detected = null;
  try {
    const d = jschardet.detect(buffer.subarray(0, 64 * 1024));
    if (d && d.encoding) detected = { name: d.encoding.toLowerCase(), conf: d.confidence || 0 };
  } catch {
    /* детектор не обязателен */
  }

  const order = [];
  if (detected && iconv.encodingExists(detected.name)) order.push(detected.name);
  for (const c of CANDIDATES) if (!order.includes(c)) order.push(c);

  let best = null;
  for (const enc of order) {
    let text;
    try {
      text = stripBom(iconv.decode(buffer, enc));
    } catch {
      continue;
    }
    const score = mojibakeScore(text);
    // Бонус за кириллицу: верная кодировка даёт много русских букв.
    const cyr = (text.slice(0, 20000).match(/[а-яёА-ЯЁ]/g) || []).length / Math.max(1, Math.min(20000, text.length));
    const total = score - cyr;
    if (!best || total < best.total) best = { text, encoding: enc, total, score };
    if (score < 0.001 && cyr > 0.2) break; // уверенное попадание
  }

  if (!best) return { text: buffer.toString('utf8'), encoding: 'utf-8 (fallback)', guessConfidence: 0 };
  return {
    text: best.text,
    encoding: best.encoding,
    guessConfidence: detected && detected.name === best.encoding ? detected.conf : 0.5,
  };
}

/**
 * @param {Buffer} buffer
 * @returns {{rawParas:Array, encoding:string, warnings:string[]}}
 */
function parseTxt(buffer) {
  const warnings = [];
  const { text, encoding, guessConfidence } = decodeText(buffer);
  if (guessConfidence && guessConfidence < 0.6) {
    warnings.push(`Кодировка определена неуверенно (${encoding}) — проверьте текст на искажения`);
  }
  if (text.includes('�')) warnings.push('В тексте есть символы-замены (�): исходная кодировка повреждена');

  const lines = cleanInline(text).split('\n');
  const paras = looksHardWrapped(lines)
    ? unwrapLines(lines)
    : lines.map((l) => l.trim()).filter((l) => l.length > 0);

  const rawParas = paras.map((p) => ({ runs: [makeRun(p)] }));
  return { rawParas, encoding, warnings };
}

module.exports = { parseTxt, decodeText };

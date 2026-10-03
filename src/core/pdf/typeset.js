'use strict';

const { splitToFit } = require('./hyphenate');

/** Во сколько раз пробел может растянуться, прежде чем строка уйдёт влево. */
const MAX_SPACE_STRETCH = 2.35;

/** Ключи зарегистрированных в PDFKit начертаний. */
const FONT = {
  serif: 'serif',
  serifB: 'serifB',
  serifI: 'serifI',
  serifBI: 'serifBI',
  sans: 'sans',
  sansB: 'sansB',
  sansI: 'sansI',
};

/**
 * Регистрирует шрифты в документе и возвращает кэширующий измеритель.
 * @param {PDFDocument} doc
 * @param {{serif:object, sans:object}} fonts
 */
function createMeasurer(doc, fonts) {
  doc.registerFont(FONT.serif, fonts.serif.regular);
  doc.registerFont(FONT.serifB, fonts.serif.bold);
  doc.registerFont(FONT.serifI, fonts.serif.italic);
  doc.registerFont(FONT.serifBI, fonts.serif.boldItalic);
  doc.registerFont(FONT.sans, fonts.sans.regular);
  doc.registerFont(FONT.sansB, fonts.sans.bold);
  doc.registerFont(FONT.sansI, fonts.sans.italic);
  if (fonts.fallback) doc.registerFont('fallback', fonts.fallback);

  const cache = new Map();
  const coverage = new Map();
  function supports(fontKey, char) {
    const key = `${fontKey}|${char}`;
    if (!coverage.has(key)) {
      doc.font(fontKey);
      coverage.set(key, !!doc._font.font && doc._font.font.hasGlyphForCodePoint(char.codePointAt(0)));
    }
    return coverage.get(key);
  }
  function parts(text, fontKey) {
    if (!fonts.fallback || fontKey === 'fallback') return [{ text, fontKey }];
    const out = [];
    for (const char of text) {
      const key = supports(fontKey, char) || !supports('fallback', char) ? fontKey : 'fallback';
      const last = out[out.length-1];
      if (last && last.fontKey === key) last.text += char;
      else out.push({ text: char, fontKey: key });
    }
    return out;
  }

  /** Ширина строки в pt для заданного начертания и кегля. */
  function width(text, fontKey, size) {
    if (!text) return 0;
    const key = `${fontKey}\u0000${size}\u0000${text}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    let w = 0;
    for (const part of parts(text, fontKey)) {
      doc.font(part.fontKey).fontSize(size);
      w += doc.widthOfString(part.text);
    }
    // Кэшируем только короткие строки: длинные уникальны и лишь едят память.
    if (text.length <= 48) cache.set(key, w);
    return w;
  }

  return { width, cache, parts };
}

/** Начертание по форматированию run'а. */
function fontFor(family, fmt) {
  if (family === 'sans') {
    if (fmt.b) return FONT.sansB;
    if (fmt.i) return FONT.sansI;
    return FONT.sans;
  }
  if (fmt.b && fmt.i) return FONT.serifBI;
  if (fmt.b) return FONT.serifB;
  if (fmt.i) return FONT.serifI;
  return FONT.serif;
}

/**
 * Runs → токены слов. NBSP не считается разделителем:
 * «стр. 5» и «И. И. Иванов» не разрываются.
 */
function tokenize(runs, family) {
  const tokens = [];
  for (const run of runs || []) {
    const fmt = { b: run.b, i: run.i, u: run.u, link: run.link };
    const fontKey = fontFor(family, fmt);
    const parts = String(run.text).split(/([ \t]+)/);
    for (const part of parts) {
      if (!part) continue;
      if (/^[ \t]+$/.test(part)) {
        if (tokens.length) tokens[tokens.length - 1].spaceAfter = true;
        continue;
      }
      tokens.push({ text: part, fmt, fontKey, spaceAfter: false });
    }
  }
  // Последний токен не несёт пробела.
  if (tokens.length) tokens[tokens.length - 1].spaceAfter = false;
  return tokens;
}

/**
 * Разбивка токенов на строки с выключкой.
 *
 * @param {Array} tokens
 * @param {object} o
 * @param {number} o.width        ширина колонки
 * @param {number} o.size         кегль
 * @param {number} o.firstIndent  абзацный отступ первой строки
 * @param {boolean} o.justify
 * @param {boolean} o.hyphenate
 * @param {(t:string,f:string,s:number)=>number} o.measure
 * @param {'left'|'center'|'right'|'justify'} [o.align]
 * @returns {Array<{items:Array,height:number,align:string}>}
 */
function layoutText(tokens, o) {
  const measure = o.measure;
  const size = o.size;
  const avail = o.width;
  const align = o.align || (o.justify ? 'justify' : 'left');
  const spaceW = measure(' ', tokens[0] ? tokens[0].fontKey : FONT.serif, size);

  const lines = [];
  let cur = [];
  let curWidth = 0;
  let indent = o.firstIndent || 0;

  const pushLine = (isLast) => {
    if (!cur.length) return;
    lines.push(finishLine(cur, { avail, indent, align, isLast, spaceW, measure, size }));
    cur = [];
    curWidth = 0;
    indent = 0;
  };

  const queue = tokens.map((t) => ({ ...t }));
  let qi = 0;

  while (qi < queue.length) {
    const tok = queue[qi];
    const w = measure(tok.text, tok.fontKey, size);
    const gap = cur.length ? (cur[cur.length - 1].spaceAfter === false ? 0 : spaceW) : 0;
    const x = indent + curWidth + gap;

    if (x + w <= avail || !cur.length) {
      // Слово влезает — либо строка пуста и его всё равно надо поставить.
      if (!cur.length && indent + w > avail && o.hyphenate) {
        const part = splitToFit(tok.text, avail - indent, (s) => measure(s, tok.fontKey, size));
        if (part) {
          cur.push({ ...tok, text: part.head, spaceAfter: false, hyphenated: true });
          curWidth += measure(part.head, tok.fontKey, size);
          queue.splice(qi + 1, 0, { ...tok, text: part.tail });
          qi += 1;
          pushLine(false);
          continue;
        }
      }
      cur.push(tok);
      curWidth += gap + w;
      qi += 1;
      continue;
    }

    // Не влезает: пробуем перенос по слогам в остаток строки.
    if (o.hyphenate) {
      const room = avail - x;
      const part = splitToFit(tok.text, room, (s) => measure(s, tok.fontKey, size));
      if (part) {
        cur.push({ ...tok, text: part.head, spaceAfter: false, hyphenated: true });
        curWidth += gap + measure(part.head, tok.fontKey, size);
        queue.splice(qi + 1, 0, { ...tok, text: part.tail });
        qi += 1;
        pushLine(false);
        continue;
      }
    }

    pushLine(false);
  }
  pushLine(true);

  return lines;
}

/** Расстановка слов по горизонтали и решение о выключке конкретной строки. */
function finishLine(tokens, { avail, indent, align, isLast, spaceW, measure, size }) {
  const words = tokens.map((t) => ({
    text: t.text,
    fmt: t.fmt,
    fontKey: t.fontKey,
    w: measure(t.text, t.fontKey, size),
    spaceAfter: t.spaceAfter !== false,
  }));

  const sumWords = words.reduce((a, b) => a + b.w, 0);
  const gaps = Math.max(0, words.filter((w, i) => i < words.length - 1 && w.spaceAfter).length);

  let lineAlign = align;
  let space = spaceW;

  if (align === 'justify') {
    if (isLast || gaps === 0) {
      lineAlign = 'left';
    } else {
      const need = (avail - indent - sumWords) / gaps;
      // Плохая выключка — честнее отдать строку влево (п.4 спецификации).
      if (need > spaceW * MAX_SPACE_STRETCH || need < spaceW * 0.62) {
        lineAlign = 'left';
      } else {
        space = need;
      }
    }
  }

  let x = indent;
  if (lineAlign === 'center') x = indent + (avail - indent - sumWords - gaps * spaceW) / 2;
  else if (lineAlign === 'right') x = avail - sumWords - gaps * spaceW;

  for (let i = 0; i < words.length; i += 1) {
    words[i].x = x;
    x += words[i].w;
    if (i < words.length - 1 && words[i].spaceAfter) x += lineAlign === 'justify' ? space : spaceW;
  }

  return { items: words, align: lineAlign, naturalWidth: sumWords + gaps * spaceW + indent };
}

module.exports = { createMeasurer, layoutText, tokenize, fontFor, FONT, MAX_SPACE_STRETCH };

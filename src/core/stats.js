'use strict';

const { blockText, chapterLabel, KIND } = require('./model');

/**
 * Статистика за один проход по единому представлению книги (п.7 спецификации).
 * Считается только литературный текст: разметка, оглавление, навигация,
 * колонтитулы и метаданные в подсчёт не попадают, потому что их в IR нет.
 */

const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}''’́\-]*/gu;

function countWords(text) {
  const m = text.match(WORD_RE);
  return m ? m.length : 0;
}

function computeStats(chapters) {
  let words = 0;
  let wordsWithHeadings = 0;
  let charsWithSpaces = 0;
  let charsNoSpaces = 0;
  let images = 0;
  let systemBlocks = 0;
  let chapterCount = 0;

  const active = chapters.filter((c) => c.include);

  for (const ch of active) {
    let chWords = 0;
    let chWithHeadings = 0;
    let chCharsWith = 0;
    let chCharsNo = 0;
    let chImages = 0;
    let chSystem = 0;

    // Заголовок раздела (opener) идёт только в «слова с заголовками».
    const headingText = chapterLabel(ch);
    chWithHeadings += countWords(headingText);

    for (const b of ch.blocks) {
      if (b.type === 'image') {
        chImages += 1;
        continue;
      }
      if (b.type === 'sep') continue;

      const text = blockText(b);
      if (b.type === 'system') chSystem += 1;

      const w = countWords(text);
      if (b.type === 'heading') {
        chWithHeadings += w;
      } else {
        chWords += w;
        chWithHeadings += w;
        chCharsWith += text.length;
        chCharsNo += text.replace(/\s/gu, '').length;
      }
    }

    ch.words = chWords;
    ch.wordsWithHeadings = chWithHeadings;
    ch.charsWithSpaces = chCharsWith;
    ch.charsNoSpaces = chCharsNo;
    ch.images = chImages;
    ch.systemBlocks = chSystem;

    words += chWords;
    wordsWithHeadings += chWithHeadings;
    charsWithSpaces += chCharsWith;
    charsNoSpaces += chCharsNo;
    images += chImages;
    systemBlocks += chSystem;
    if (ch.kind === KIND.CHAPTER) chapterCount += 1;
  }

  const countedSections = active.filter((c) => c.words > 0).length || 1;

  return {
    sections: active.length,
    chapters: chapterCount,
    words,
    wordsWithHeadings,
    charsWithSpaces,
    charsNoSpaces,
    images,
    systemBlocks,
    avgWordsPerChapter: Math.round(words / countedSections),
  };
}

module.exports = { computeStats, countWords };

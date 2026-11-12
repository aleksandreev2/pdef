'use strict';

const { blockText, chapterLabel, KIND } = require('./model');

/**
 * Статистика за один проход по единому представлению книги (п.7 спецификации).
 * Считается только литературный текст: разметка, оглавление, навигация,
 * колонтитулы и метаданные в подсчёт не попадают, потому что их в IR нет.
 */

const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}''’́\-]*/gu;
const statsByBlocks = new WeakMap();

function countWords(text) {
  const m = text.match(WORD_RE);
  return m ? m.length : 0;
}

function contentStats(blocks) {
  let stats = statsByBlocks.get(blocks);
  if (stats) return stats;
  stats = { words: 0, wordsWithHeadings: 0, charsWithSpaces: 0, charsNoSpaces: 0, images: 0, systemBlocks: 0 };
  for (const block of blocks) {
    if (block.type === 'image') {
      stats.images += 1;
      continue;
    }
    if (block.type === 'sep') continue;
    const text = blockText(block);
    const words = countWords(text);
    stats.wordsWithHeadings += words;
    if (block.type === 'heading') continue;
    if (block.type === 'system') stats.systemBlocks += 1;
    stats.words += words;
    stats.charsWithSpaces += text.length;
    stats.charsNoSpaces += text.replace(/\s/gu, '').length;
  }
  statsByBlocks.set(blocks, stats);
  return stats;
}

function computeStats(chapters) {
  let words = 0;
  let wordsWithHeadings = 0;
  let charsWithSpaces = 0;
  let charsNoSpaces = 0;
  let images = 0;
  let systemBlocks = 0;
  let chapterCount = 0;

  let sections = 0;
  let countedSections = 0;
  for (const ch of chapters) {
    const stats = contentStats(ch.blocks);
    Object.assign(ch, stats);
    ch.wordsWithHeadings += countWords(chapterLabel(ch));
    if (!ch.include) continue;

    sections += 1;
    if (stats.words > 0) countedSections += 1;
    words += stats.words;
    wordsWithHeadings += ch.wordsWithHeadings;
    charsWithSpaces += stats.charsWithSpaces;
    charsNoSpaces += stats.charsNoSpaces;
    images += stats.images;
    systemBlocks += stats.systemBlocks;
    if (ch.kind === KIND.CHAPTER) chapterCount += 1;
  }

  return {
    sections,
    chapters: chapterCount,
    words,
    wordsWithHeadings,
    charsWithSpaces,
    charsNoSpaces,
    images,
    systemBlocks,
    avgWordsPerChapter: Math.round(words / (countedSections || 1)),
  };
}

module.exports = { computeStats, countWords, contentStats };

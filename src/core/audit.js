'use strict';

const crypto = require('crypto');
const { KIND, blockText, chapterLabel } = require('./model');

/**
 * Быстрый аудит исходников (п.1 спецификации).
 * Дубли ищутся по номеру/заголовку → хешу → и только для подозрительных
 * совпадений выполняется текстовое сравнение. Попарное сравнение всех
 * глав со всеми не делается.
 */

function chapterPlainText(ch) {
  return ch.blocks.map(blockText).join('\n');
}

function normForHash(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function countWords(text) {
  const m = text.match(/[\p{L}\p{N}][\p{L}\p{N}''’\-]*/gu);
  return m ? m.length : 0;
}

/** Ключ тождества главы: номер+тип, иначе нормализованное название. */
function identityKey(ch) {
  if (ch.number !== null) return `${ch.kind}#${ch.number}`;
  const t = normForHash(ch.title || ch.sourceName);
  return `${ch.kind}:${t}`;
}

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * @param {Array} chapters  уже отсортированные главы
 * @returns {object} отчёт аудита; главы мутируются (issues, include, служебные поля)
 */
function auditChapters(chapters) {
  const report = {
    total: chapters.length,
    included: 0,
    chapters: 0,
    extras: [],
    numbers: [],
    gaps: [],
    duplicates: [],
    empty: [],
    broken: [],
    shortSuspects: [],
    encodings: {},
    images: { total: 0, inChapters: 0, gallery: 0 },
    firstNumber: null,
    lastNumber: null,
  };

  // Предрасчёт: текст, хеш, слова, картинки.
  for (const ch of chapters) {
    const text = chapterPlainText(ch);
    ch._text = text;
    ch._hash = crypto.createHash('sha1').update(normForHash(text)).digest('hex');
    ch._words = countWords(text);
    ch._images = ch.blocks.filter((b) => b.type === 'image').length;
    ch._blockCount = ch.blocks.length;

    if (ch.encoding) {
      report.encodings[ch.encoding] = (report.encodings[ch.encoding] || 0) + 1;
    }
    const broken = ch.issues.some((i) => i.startsWith('Файл не разобран'));
    if (!ch.blocks.length && !broken) {
      report.empty.push({ file: ch.sourceName, label: chapterLabel(ch) });
      ch.include = false;
    }
    if (broken) {
      report.broken.push({ file: ch.sourceName, reason: ch.issues[0] });
    }
  }

  /* ── дубли и несколько версий одной главы ── */
  const groups = new Map();
  for (const ch of chapters) {
    const key = identityKey(ch);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(ch);
  }

  for (const [key, group] of groups) {
    if (group.length < 2) continue;

    // Выбираем наиболее полную валидную версию.
    const ranked = [...group].sort((a, b) => {
      const aBad = a.issues.some((i) => i.startsWith('Файл не разобран')) ? 1 : 0;
      const bBad = b.issues.some((i) => i.startsWith('Файл не разобран')) ? 1 : 0;
      if (aBad !== bBad) return aBad - bBad;
      if (b._words !== a._words) return b._words - a._words;
      if (b._images !== a._images) return b._images - a._images;
      return b._blockCount - a._blockCount;
    });
    const winner = ranked[0];
    const identical = group.every((g) => g._hash === winner._hash);

    for (const ch of ranked.slice(1)) {
      ch.include = false;
      ch.issues.push(
        identical
          ? `Точный дубль: выбрана версия из «${winner.sourceName}»`
          : `Другая версия этой главы (${ch._words} слов против ${winner._words}): выбрана «${winner.sourceName}»`,
      );
    }

    report.duplicates.push({
      key,
      label: chapterLabel(winner),
      identical,
      kept: winner.sourceName,
      dropped: ranked.slice(1).map((c) => ({ file: c.sourceName, words: c._words })),
    });
  }

  return refreshAuditSelection(report, chapters);
}

/** Recheck the selected book without reselecting duplicate versions. */
function refreshAuditSelection(report, chapters) {
  report.gaps = [];
  report.firstNumber = null;
  report.lastNumber = null;
  report.shortSuspects = [];
  report.chapters = 0;
  report.extras = [];
  report.images = { total: 0, inChapters: 0, gallery: 0 };
  for (const ch of chapters) ch.issues = ch.issues.filter(i => !i.startsWith('Глава заметно короче остальных'));
  /* ── нумерация и пропуски ── */
  const active = chapters.filter((c) => c.include);
  const nums = active
    .filter((c) => c.kind === KIND.CHAPTER && c.number !== null)
    .map((c) => c.number)
    .sort((a, b) => a - b);

  report.numbers = nums;
  if (nums.length) {
    report.firstNumber = nums[0];
    report.lastNumber = nums[nums.length - 1];
    const present = new Set(nums);
    for (let n = nums[0]; n <= nums[nums.length - 1]; n += 1) {
      if (!present.has(n)) report.gaps.push(n);
    }
  }

  /* ── подозрительно короткие главы ── */
  const wordCounts = active.filter((c) => c.kind === KIND.CHAPTER && c._words > 0).map((c) => c._words);
  const med = median(wordCounts);
  if (med > 0) {
    for (const ch of active) {
      if (ch.kind !== KIND.CHAPTER) continue;
      if (ch._words > 0 && ch._words < med * 0.2) {
        report.shortSuspects.push({ label: chapterLabel(ch), words: ch._words, median: Math.round(med) });
        ch.issues.push(`Глава заметно короче остальных (${ch._words} слов при медиане ${Math.round(med)})`);
      }
    }
  }

  /* ── разделы и иллюстрации ── */
  for (const ch of active) {
    if (ch.kind === KIND.CHAPTER) report.chapters += 1;
    else report.extras.push({ kind: ch.kind, label: chapterLabel(ch) });
    report.images.total += ch._images;
    if (ch.kind === KIND.COVER_GALLERY) report.images.gallery += ch._images;
    else report.images.inChapters += ch._images;
  }
  report.included = active.length;

  return report;
}

/** Compact consecutive missing numbers so long gaps remain readable. */
function missingNumbers(numbers) {
  const ranges = [];
  const pad = n => String(n).padStart(3, '0');
  for (let i = 0; i < numbers.length; i += 1) {
    const start = numbers[i];
    while (i + 1 < numbers.length && numbers[i + 1] === numbers[i] + 1) i += 1;
    ranges.push(start === numbers[i] ? pad(start) : `${pad(start)}–${pad(numbers[i])}`);
  }
  return ranges.join(', ');
}

function auditWarnings(report) {
  return [
    ...(report.gaps.length ? [`В выбранной книге отсутствуют главы: ${missingNumbers(report.gaps)}. Проверьте исходники и включённые главы.`] : []),
    ...report.empty.map(e => `Пустой файл «${e.file}»: нет текста или иллюстраций. Он исключён из книги.`),
    ...report.broken.map(e => `Файл «${e.file}» не разобран и исключён из книги: ${e.reason.replace(/^Файл не разобран:\s*/, '')}`),
  ];
}

module.exports = { auditChapters, refreshAuditSelection, auditWarnings, countWords, chapterPlainText };

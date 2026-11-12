'use strict';

const crypto = require('crypto');
const { KIND, chapterLabel } = require('./model');
const { contentStats } = require('./stats');

const duplicateIssue = 'Совпадение глав:';
const hashByBlocks = new WeakMap();

function normForHash(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function contentHash(blocks) {
  if (!hashByBlocks.has(blocks)) {
    const hash = crypto.createHash('sha256').update(JSON.stringify(blocks)).digest('hex');
    hashByBlocks.set(blocks, hash);
  }
  return hashByBlocks.get(blocks);
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

  for (const ch of chapters) {
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

  return refreshAuditSelection(report, chapters);
}

function findDuplicates(chapters) {
  const groups = new Map();
  for (const ch of chapters) {
    if (!ch.blocks.length) continue;
    const key = identityKey(ch);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(ch);
  }

  const duplicates = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const [first] = group;
    const hash = contentHash(first.blocks);
    const identical = group.every(ch => contentHash(ch.blocks) === hash);
    for (const ch of group) {
      ch.issues.push(`${duplicateIssue} ${identical ? 'точный дубль' : 'другая версия'}`);
    }
    duplicates.push({
      number: first.number,
      label: chapterLabel(first),
      identical,
      versions: group.map(ch => ({ file: ch.sourceName, words: contentStats(ch.blocks).words, include: ch.include })),
    });
  }
  return duplicates;
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
  for (const ch of chapters) {
    ch.issues = ch.issues.filter(i => !i.startsWith('Глава заметно короче остальных') && !i.startsWith(duplicateIssue));
  }
  report.duplicates = findDuplicates(chapters);
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
  const wordCounts = active.filter(c => c.kind === KIND.CHAPTER).map(c => contentStats(c.blocks).words).filter(n => n > 0);
  const med = median(wordCounts);
  if (med > 0) {
    for (const ch of active) {
      if (ch.kind !== KIND.CHAPTER) continue;
      const { words } = contentStats(ch.blocks);
      if (words > 0 && words < med * 0.2) {
        report.shortSuspects.push({ label: chapterLabel(ch), words, median: Math.round(med) });
        ch.issues.push(`Глава заметно короче остальных (${words} слов при медиане ${Math.round(med)})`);
      }
    }
  }

  /* ── разделы и иллюстрации ── */
  for (const ch of active) {
    if (ch.kind === KIND.CHAPTER) report.chapters += 1;
    else report.extras.push({ kind: ch.kind, label: chapterLabel(ch) });
    const { images } = contentStats(ch.blocks);
    report.images.total += images;
    if (ch.kind === KIND.COVER_GALLERY) report.images.gallery += images;
    else report.images.inChapters += images;
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
  const warnings = [
    ...(report.gaps.length ? [`В выбранной книге отсутствуют главы: ${missingNumbers(report.gaps)}. Проверьте исходники и включённые главы.`] : []),
    ...report.empty.map(e => `Пустой файл «${e.file}»: нет текста или иллюстраций. Он исключён из книги.`),
    ...report.broken.map(e => `Файл «${e.file}» не разобран и исключён из книги: ${e.reason.replace(/^Файл не разобран:\s*/, '')}`),
  ];
  for (const match of report.duplicates) {
    const included = match.versions.filter(version => version.include);
    if (included.length < 2) continue;
    const reason = match.number === null ? 'Выбрано несколько разделов с одним названием' : 'Выбрано несколько глав с одним номером';
    warnings.push(`${reason} «${match.label}»: ${included.map(version => version.file).join(', ')}.`);
  }
  return warnings;
}

module.exports = { auditChapters, refreshAuditSelection, auditWarnings };

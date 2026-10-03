'use strict';

const path = require('path');
const fs = require('fs/promises');

const { importSources, sortChapters } = require('./import');
const { auditChapters } = require('./audit');
const { computeStats } = require('./stats');
const { clampStyle } = require('./style');
const { resolveFonts } = require('./fonts');
const { makeBook, chapterLabel, KIND } = require('./model');
const { buildPdf } = require('./pdf/build');
const { buildEpub } = require('./epub/build');
const { checkPdf } = require('./qa/pdf');
const { checkEpub } = require('./qa/epub');

/**
 * Один разобранный исходник — два формата (п.0 спецификации).
 * Состояние книги живёт в main-процессе; в интерфейс уходят только
 * сериализуемые сводки.
 */

/* ───────────────────────────── состояние сессии ───────────────────────────── */

const session = {
  book: null,
  loose: [],
  warnings: [],
  fontWarnings: [],
};

/* ───────────────────────────────── анализ ───────────────────────────────── */

/**
 * Разбор исходников, аудит и статистика — один проход.
 * @param {string[]} paths
 * @param {(p:object)=>void} onProgress
 */
async function analyze(paths, onProgress = () => {}) {
  onProgress({ phase: 'import', label: 'Чтение исходников' });

  const { chapters, assets, loose, warnings } = await importSources(paths, {
    onProgress: ({ done, total, label }) =>
      onProgress({ phase: 'import', label: `Разбор: ${label}`, done, total }),
  });

  onProgress({ phase: 'audit', label: 'Аудит глав' });
  const audit = auditChapters(chapters);

  onProgress({ phase: 'stats', label: 'Подсчёт статистики' });
  const stats = computeStats(chapters);

  const book = makeBook();
  book.chapters = chapters;
  book.assets = assets;
  book.audit = audit;
  book.stats = stats;

  // Кандидаты на обложку: отдельные картинки рядом + первая иллюстрация галереи.
  const gallery = chapters.find((c) => c.kind === KIND.COVER_GALLERY);
  const galleryFirst = gallery ? gallery.blocks.find((b) => b.type === 'image') : null;
  const coverCandidates = [
    ...loose.map((l) => ({ assetId: l.assetId, name: l.name, source: 'файл рядом с главами' })),
    ...(galleryFirst ? [{ assetId: galleryFirst.assetId, name: 'первая иллюстрация галереи', source: gallery.sourceName }] : []),
  ];
  if (galleryFirst) book.cover = { assetId: galleryFirst.assetId };
  else if (loose.length) book.cover = { assetId: loose[0].assetId };

  session.book = book;
  session.loose = loose;
  session.warnings = warnings;

  return {
    summary: summarize(book),
    audit,
    stats,
    warnings,
    coverCandidates,
    cover: book.cover,
    fonts: resolveFonts({}).warnings,
  };
}

/** Сериализуемая сводка по главам — без самих блоков. */
function summarize(book) {
  return {
    chapters: book.chapters.map((ch) => ({
      id: ch.id,
      kind: ch.kind,
      number: ch.number,
      title: ch.title,
      label: chapterLabel(ch),
      sourceName: ch.sourceName,
      include: ch.include,
      issues: ch.issues,
      encoding: ch.encoding,
      words: ch.words,
      images: ch.images,
      systemBlocks: ch.systemBlocks,
      blocks: ch.blocks.length,
    })),
    assets: [...book.assets.values()].map((a) => ({ id: a.id, ext: a.ext, bytes: a.data.length })),
  };
}

/** Применение правок из интерфейса: порядок, включение, названия. */
function applyEdits(edits = {}) {
  if (!session.book) throw new Error('Сначала выполните разбор исходников');
  const book = session.book;

  if (Array.isArray(edits.chapters)) {
    const byId = new Map(book.chapters.map((c) => [c.id, c]));
    for (const patch of edits.chapters) {
      const ch = byId.get(patch.id);
      if (!ch) continue;
      if (typeof patch.include === 'boolean') ch.include = patch.include;
      if (typeof patch.title === 'string') ch.title = patch.title;
      if (patch.number === null || Number.isFinite(patch.number)) ch.number = patch.number;
      if (typeof patch.kind === 'string') ch.kind = patch.kind;
    }
    if (Array.isArray(edits.order) && edits.order.length) {
      const pos = new Map(edits.order.map((id, i) => [id, i]));
      book.chapters.sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
    } else {
      sortChapters(book.chapters);
    }
  }

  if (edits.cover !== undefined) {
    book.cover = edits.cover ? { assetId: edits.cover } : null;
  }

  // Статистика пересчитывается, потому что состав глав изменился.
  book.stats = computeStats(book.chapters);
  return { summary: summarize(book), stats: book.stats };
}

/* ───────────────────────────── имена файлов ───────────────────────────── */

function sanitizeName(s) {
  return String(s)
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
}

/** `[Название_книги]_главы_[первая]-[последняя]` (п.12 спецификации). */
function outputBaseName(book) {
  const base = sanitizeName(book.title || 'Книга');
  const nums = book.chapters
    .filter((c) => c.include && c.kind === KIND.CHAPTER && c.number !== null)
    .map((c) => c.number)
    .sort((a, b) => a - b);
  if (!nums.length) return `${base}_полное_издание`;
  const width = Math.max(3, String(nums[nums.length - 1]).length);
  const first = String(nums[0]).padStart(width, '0');
  const last = String(nums[nums.length - 1]).padStart(width, '0');
  return `${base}_главы_${first}-${last}`;
}

/* ───────────────────────────────── сборка ───────────────────────────────── */

/**
 * @param {object} opts
 * @param {object} opts.meta   { title, team, teamUrl, subtitle }
 * @param {object} opts.style
 * @param {string} opts.outDir
 * @param {{pdf:boolean, epub:boolean}} opts.formats
 */
async function build(opts, onProgress = () => {}) {
  if (!session.book) throw new Error('Сначала выполните разбор исходников');
  const book = session.book;

  Object.assign(book, {
    title: opts.meta.title || book.title || 'Книга',
    subtitle: opts.meta.subtitle || 'Полное издание',
    team: opts.meta.team || book.team,
    teamUrl: opts.meta.teamUrl || book.teamUrl,
    language: opts.meta.language || 'ru',
  });

  const style = clampStyle(opts.style);
  const { serif, sans, fallback, warnings: fontWarnings } = resolveFonts(style);
  if (!serif || !sans) {
    throw new Error('Не найдены шрифты для сборки PDF. Положите PTSerif-Regular.ttf и PTSans-Regular.ttf в assets/fonts');
  }
  session.fontWarnings = fontWarnings;

  book.stats = computeStats(book.chapters);
  const active = book.chapters.filter((c) => c.include && c.blocks.length);
  if (!active.length) throw new Error('Нет ни одной главы для сборки');

  await fs.mkdir(opts.outDir, { recursive: true });
  const base = outputBaseName(book);
  const pdfPath = path.join(opts.outDir, `${base}.pdf`);
  const epubPath = path.join(opts.outDir, `${base}.epub`);

  const wantPdf = opts.formats.pdf !== false;
  const wantEpub = opts.formats.epub !== false;

  // Независимые операции выполняются параллельно (п.10 спецификации).
  const tasks = [];
  tasks.push(
    wantPdf
      ? buildPdf({ book, style, fonts: { serif, sans, fallback }, outPath: pdfPath, onProgress })
      : Promise.resolve(null),
  );
  tasks.push(wantEpub ? buildEpub({ book, style, outPath: epubPath, onProgress }) : Promise.resolve(null));

  const [pdfResult, epubResult] = await Promise.all(tasks);

  /* ── QA: по одному проходу на формат, параллельно ── */
  onProgress({ phase: 'qa', label: 'Проверка готовых файлов' });
  const expected = {
    sections: active.length,
    tocPages: pdfResult ? pdfResult.tocPages : 0,
    tocFirstPage: pdfResult ? pdfResult.tocFirstPage : 3,
    chapterPages: pdfResult ? pdfResult.chapterPages : {},
    firstContentPage: pdfResult ? pdfResult.firstContentPage : 1,
  };

  const [pdfQa, epubQa] = await Promise.all([
    pdfResult ? checkPdf(pdfPath, { book, expected }) : Promise.resolve(null),
    epubResult ? checkEpub(epubPath, { book, expected }) : Promise.resolve(null),
  ]);

  const report = {
    title: book.title,
    base,
    pdf: pdfResult && {
      path: pdfPath,
      pages: pdfResult.pages,
      tocPages: pdfResult.tocPages,
      size: pdfResult.size,
      bookmarks: pdfResult.bookmarks,
      warnings: pdfResult.warnings,
    },
    epub: epubResult && {
      path: epubPath,
      size: epubResult.size,
      documents: epubResult.documents,
      images: epubResult.images,
      warnings: epubResult.warnings,
    },
    stats: book.stats,
    audit: book.audit,
    style: {
      genre: style.genre,
      genreName: style.name,
      serif: serif.name,
      sans: sans.name,
      bodySize: style.bodySize,
      lineHeight: style.lineHeight,
      accent: style.accent,
      signature: style.signature,
      pageFormat: `${style.pageWidthMm} × ${style.pageHeightMm} мм`,
    },
    fontWarnings,
    qa: { pdf: pdfQa, epub: epubQa },
  };

  return report;
}

/** Данные ресурса как data URL — для предпросмотра обложки в интерфейсе. */
function assetDataUrl(assetId) {
  if (!session.book) return null;
  const asset = session.book.assets.get(assetId);
  if (!asset) return null;
  return `data:${asset.mime};base64,${asset.data.toString('base64')}`;
}

function getSession() {
  return session;
}

module.exports = { analyze, applyEdits, build, assetDataUrl, getSession, outputBaseName, sanitizeName };

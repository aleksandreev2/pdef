'use strict';

const fs = require('fs/promises');
const { bodyText } = require('../model');

/**
 * Структурная проверка готового PDF одним проходом (п.8.1 спецификации).
 * Каждое свойство проверяется один раз; повторных проверок того же
 * свойства другим способом не делается.
 */

let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  }
  return pdfjsPromise;
}

function check(name, ok, detail) {
  return { name, ok: !!ok, detail: detail || '' };
}

/**
 * @param {string} pdfPath
 * @param {{book:object, expected:object}} ctx
 */
async function checkPdf(pdfPath, { book, expected }) {
  const pdfjs = await loadPdfjs();
  const file = await fs.readFile(pdfPath);
  const data = new Uint8Array(file.buffer, file.byteOffset, file.byteLength);
  const checks = [];
  const notes = [];

  let doc;
  try {
    doc = await pdfjs.getDocument({ data, useSystemFonts: false, isEvalSupported: false,
      fontExtraProperties: true, disableFontFace: true }).promise;
  } catch (e) {
    return {
      ok: false,
      checks: [check('PDF открывается', false, e.message)],
      notes,
      pages: 0,
    };
  }
  try {
    return await inspectPdf(doc, { book, expected, pdfjs, checks, notes });
  } finally {
    await doc.destroy();
  }
}

async function inspectPdf(doc, { book, expected, pdfjs, checks, notes }) {
  checks.push(check('PDF открывается', true));
  const numPages = doc.numPages;
  checks.push(check('Количество страниц больше нуля', numPages > 0, `страниц: ${numPages}`));

  const tocFirst = expected.tocFirstPage || 3;
  const tocPages = expected.tocPages || 0;
  const aboutPage = tocFirst + tocPages;
  const firstContent = Math.min(numPages, expected.firstContentPage || 1);
  const imagePages = expected.imagePages ? new Set(expected.imagePages) : null;
  const imageOperators = new Set([pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject,
    pdfjs.OPS.paintInlineImageXObjectGroup, pdfjs.OPS.paintImageXObjectRepeat]);
  const fonts = new Map();
  let sampledContentFonts = false;
  const pageInfo = [];
  for (let i = 1; i <= numPages; i += 1) {
    const page = await doc.getPage(i);
    const [textContent, annots] = await Promise.all([
      page.getTextContent(),
      i === 2 || (i >= tocFirst && i <= aboutPage) ? page.getAnnotations() : [],
    ]);
    const text = textContent.items.map((it) => it.str).join('');
    const textLength = text.replace(/\s/g, '').length;
    const sampleFonts = i === 2 || (!sampledContentFonts && i >= firstContent && textLength > 0);
    let imageOps = 0;
    let drawOps = 0;
    if (!imagePages || imagePages.has(i) || i <= 2 || !textLength || sampleFonts) {
      const ops = await page.getOperatorList();
      drawOps = ops.fnArray.length;
      for (let j = 0; j < drawOps; j += 1) {
        const operation = ops.fnArray[j];
        if (imageOperators.has(operation)) imageOps += 1;
        if (sampleFonts && operation === pdfjs.OPS.setFont) {
          const [id] = ops.argsArray[j];
          if (!fonts.has(id)) {
            const font = await new Promise(resolve => page.commonObjs.get(id, resolve));
            fonts.set(id, Boolean(font.data?.length && !font.missingFile));
          }
          if (i >= firstContent) sampledContentFonts = true;
        }
      }
    }
    const links = annots.filter((a) => a.subtype === 'Link');
    pageInfo.push({
      index: i,
      textLength,
      images: imageOps,
      links,
      drawOps,
      hasSubtitle: i < firstContent && text.includes(book.subtitle || 'Полное издание'),
      hasTocHeader: i >= tocFirst && i < aboutPage && text.includes('Оглавление'),
      hasAboutHeader: i === aboutPage && text.includes('Официальная страница команды'),
      hasBadGlyphs: /[\u0000\uFFFD]/u.test(text),
    });
    page.cleanup();
  }

  /* ── обложка ── */
  const cover = pageInfo[0];
  const coverPages = pageInfo.filter((p) => p.images > 0 && p.textLength === 0 && p.index <= 2);
  checks.push(
    check(
      'Обложка одна и на первой странице',
      cover && (cover.images > 0 || cover.textLength > 0) && coverPages.length <= 1,
      cover ? `изображений на 1-й странице: ${cover.images}` : 'страниц нет',
    ),
  );
  if (cover && cover.images === 0) {
    notes.push('Первая страница без растровой обложки — собрана типографическая обложка');
  }

  /* ── титульная, оглавление, сведения ── */
  const titlePages = pageInfo.filter((p) => p.hasSubtitle);
  checks.push(check('Титульная страница одна', titlePages.length === 1, `найдено: ${titlePages.length}`));

  // Заголовок «Оглавление» печатается один раз, а сами записи могут занимать
  // несколько страниц — поэтому «одно оглавление» и «сколько страниц» это
  // разные вещи.
  const tocHeaders = pageInfo.filter((p) => p.hasTocHeader);
  const tocRange = pageInfo.slice(tocFirst - 1, tocFirst - 1 + tocPages);
  checks.push(
    check(
      'Оглавление одно',
      tocHeaders.length === 1 && tocRange.length === tocPages,
      `заголовок «Оглавление» встречается ${tocHeaders.length} раз, страниц оглавления: ${tocRange.length}`,
    ),
  );

  const aboutPages = pageInfo.filter((p) => p.hasAboutHeader);
  checks.push(check('Страница сведений о переводе одна', aboutPages.length === 1, `найдено: ${aboutPages.length}`));

  /* ── оглавление кликабельно ── */
  const tocLinks = tocRange.reduce((acc, p) => acc + p.links.filter((l) => l.dest || l.action || l.url).length, 0);
  checks.push(
    check(
      'Оглавление содержит ссылки',
      tocLinks >= expected.sections,
      `ссылок в оглавлении: ${tocLinks}, разделов: ${expected.sections}`,
    ),
  );

  /* ── внешняя ссылка на команду ── */
  const allLinks = pageInfo.flatMap((p) => p.links);
  const teamLinks = allLinks.filter((l) => l.url === book.teamUrl);
  checks.push(
    check(
      `Ссылка «${book.team}» существует как Link-аннотация`,
      teamLinks.length > 0,
      `найдено аннотаций: ${teamLinks.length}`,
    ),
  );
  const urlExact = teamLinks.every((l) => l.url === book.teamUrl);
  checks.push(
    check(
      'URL команды совпадает точно',
      teamLinks.length > 0 && urlExact,
      teamLinks.length ? teamLinks[0].url : 'аннотаций нет',
    ),
  );

  /* ── закладки ── */
  const outline = await doc.getOutline();
  const outlineCount = outline ? outline.length : 0;
  checks.push(
    check(
      'Закладки существуют и соответствуют разделам',
      outlineCount >= expected.sections + 3,
      `закладок: ${outlineCount}, ожидалось не меньше ${expected.sections + 3}`,
    ),
  );

  /* ── первая, средняя и последняя главы ── */
  const chapterPages = Object.values(expected.chapterPages || {});
  const probeIdx = chapterPages.length
    ? [chapterPages[0], chapterPages[Math.floor(chapterPages.length / 2)], chapterPages[chapterPages.length - 1]]
    : [];
  const probesOk = probeIdx.every((pn) => {
    const p = pageInfo[pn - 1];
    return p && (p.textLength > 0 || p.images > 0);
  });
  checks.push(
    check(
      'Первая, средняя и последняя главы существуют',
      probeIdx.length === 3 && probesOk,
      probeIdx.length ? `проверены страницы ${probeIdx.join(', ')}` : 'главы не найдены',
    ),
  );

  /* ── текст извлекается ── */
  const textPages = pageInfo.filter((p) => p.index >= firstContent && p.textLength > 0);
  const hasSourceText = book.chapters.some(chapter => chapter.include && chapter.blocks.some(block => bodyText(block).trim()));
  checks.push(
    check(
      'Текст извлекается (PDF-текст выделяемый и копируемый)',
      !hasSourceText || textPages.length > 0,
      `страниц с извлекаемым текстом: ${textPages.length} из ${numPages}`,
    ),
  );

  if (imagePages?.size) {
    const missing = [...imagePages].filter(index => !pageInfo[index - 1]?.images);
    checks.push(check('Иллюстрации присутствуют на ожидаемых страницах', !missing.length,
      missing.length ? `страницы: ${missing.slice(0, 5).join(', ')}` : `страниц с иллюстрациями: ${imagePages.size}`));
  }

  /* ── пустые страницы ── */
  const emptyPages = pageInfo.filter((p) => p.textLength === 0 && p.images === 0 && p.drawOps < 6);
  checks.push(
    check(
      'Нет очевидных пустых страниц',
      emptyPages.length === 0,
      emptyPages.length ? `пустые страницы: ${emptyPages.map((p) => p.index).join(', ')}` : '',
    ),
  );

  /* ── битые глифы ── */
  const badGlyphPages = pageInfo.filter((p) => p.hasBadGlyphs);
  checks.push(
    check(
      'Нет битых глифов в извлечённом тексте',
      badGlyphPages.length === 0,
      badGlyphPages.length ? `страницы: ${badGlyphPages.slice(0, 5).map((p) => p.index).join(', ')}` : '',
    ),
  );

  /* ── встроенные шрифты ── */
  const embeddedFonts = [...fonts.values()].filter(Boolean).length;
  checks.push(check('Шрифты встроены в документ', fonts.size > 0 && embeddedFonts === fonts.size,
    `встроено начертаний на пробных страницах: ${embeddedFonts} из ${fonts.size}`));

  // Страницы, представительные для визуальной проверки (п.8.2).
  const sample = pickVisualSample(pageInfo, expected);

  return {
    ok: checks.every((c) => c.ok),
    checks,
    notes,
    pages: numPages,
    visualSample: sample,
  };
}

/** Максимум 6 репрезентативных страниц: без поиска замены, если типа страницы нет. */
function pickVisualSample(pageInfo, expected) {
  const sample = [];
  const add = (index, why) => {
    if (!index || index < 1 || index > pageInfo.length) return;
    if (sample.some((s) => s.page === index)) return;
    sample.push({ page: index, why });
  };

  add(2, 'титульная страница');
  const toc = pageInfo.find((p) => p.hasTocHeader);
  if (toc) add(toc.index, 'оглавление');


  const firstText = pageInfo.find((p) => p.index >= (expected.firstContentPage || 1) && p.textLength > 200);
  if (firstText) add(firstText.index, 'первая обычная текстовая страница');

  const dense = pageInfo.reduce((longest, page) => {
    return page.index > (expected.firstContentPage || 1) + 2 && (!longest || page.textLength > longest.textLength)
      ? page : longest;
  }, null);
  if (dense) add(dense.index, 'плотная страница из середины');

  const special = pageInfo.find((p) => p.images > 0 && p.index > 2);
  if (special) add(special.index, 'страница с иллюстрацией');

  const lastText = [...pageInfo].reverse().find((p) => p.textLength > 200);
  if (lastText) add(lastText.index, 'последняя обычная текстовая страница');

  return sample.slice(0, 6);
}

module.exports = { checkPdf, loadPdfjs };

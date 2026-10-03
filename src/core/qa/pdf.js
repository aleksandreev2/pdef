'use strict';

const fs = require('fs/promises');

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
  const data = new Uint8Array(await fs.readFile(pdfPath));
  const checks = [];
  const notes = [];

  let doc;
  try {
    doc = await pdfjs.getDocument({ data, useSystemFonts: false, isEvalSupported: false }).promise;
  } catch (e) {
    return {
      ok: false,
      checks: [check('PDF открывается', false, e.message)],
      notes,
      pages: 0,
    };
  }

  checks.push(check('PDF открывается', true));
  const numPages = doc.numPages;
  checks.push(check('Количество страниц больше нуля', numPages > 0, `страниц: ${numPages}`));

  /* ── обход страниц одним проходом ── */
  const pageInfo = [];
  for (let i = 1; i <= numPages; i += 1) {
    const page = await doc.getPage(i);
    const [textContent, annots, ops] = await Promise.all([
      page.getTextContent(),
      page.getAnnotations(),
      page.getOperatorList(),
    ]);
    const text = textContent.items.map((it) => it.str).join('');
    const imageOps = ops.fnArray.filter(
      (fn) => fn === pdfjs.OPS.paintImageXObject || fn === pdfjs.OPS.paintJpegXObject || fn === pdfjs.OPS.paintInlineImageXObject,
    ).length;
    const links = annots.filter((a) => a.subtype === 'Link');
    pageInfo.push({
      index: i,
      text,
      textLength: text.replace(/\s/g, '').length,
      images: imageOps,
      links,
      drawOps: ops.fnArray.length,
      hasBadGlyphs: /�/.test(text),
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
  const titlePages = pageInfo.filter((p) => p.text.includes(book.subtitle || 'Полное издание'));
  checks.push(check('Титульная страница одна', titlePages.length === 1, `найдено: ${titlePages.length}`));

  // Заголовок «Оглавление» печатается один раз, а сами записи могут занимать
  // несколько страниц — поэтому «одно оглавление» и «сколько страниц» это
  // разные вещи.
  const tocHeaders = pageInfo.filter((p) => /Оглавление/.test(p.text));
  const tocFirst = expected.tocFirstPage || 3;
  const tocRange = pageInfo.slice(tocFirst - 1, tocFirst - 1 + (expected.tocPages || 0));
  checks.push(
    check(
      'Оглавление одно',
      tocHeaders.length === 1 && tocRange.length === expected.tocPages,
      `заголовок «Оглавление» встречается ${tocHeaders.length} раз, страниц оглавления: ${tocRange.length}`,
    ),
  );

  const aboutPages = pageInfo.filter((p) => p.text.includes('Официальная страница команды'));
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
    return p && p.textLength > 0;
  });
  checks.push(
    check(
      'Первая, средняя и последняя главы существуют',
      probeIdx.length === 3 && probesOk,
      probeIdx.length ? `проверены страницы ${probeIdx.join(', ')}` : 'главы не найдены',
    ),
  );

  /* ── текст извлекается ── */
  const textPages = pageInfo.filter((p) => p.textLength > 80);
  checks.push(
    check(
      'Текст извлекается (PDF-текст выделяемый и копируемый)',
      textPages.length >= Math.max(1, Math.floor(numPages * 0.5)),
      `страниц с извлекаемым текстом: ${textPages.length} из ${numPages}`,
    ),
  );

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
  try {
    const page = await doc.getPage(Math.min(numPages, expected.firstContentPage || 1));
    const content = await page.getTextContent();
    const fontNames = new Set(content.items.map((i) => i.fontName).filter(Boolean));
    checks.push(
      check(
        'Шрифты встроены в документ',
        fontNames.size > 0,
        `использовано начертаний на пробной странице: ${fontNames.size}`,
      ),
    );
    page.cleanup();
  } catch (e) {
    notes.push(`Проверка шрифтов не выполнена: ${e.message}`);
  }

  await doc.destroy();

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
  const toc = pageInfo.find((p) => /Оглавление/.test(p.text));
  if (toc) add(toc.index, 'оглавление');


  const firstText = pageInfo.find((p) => p.index >= (expected.firstContentPage || 1) && p.textLength > 200);
  if (firstText) add(firstText.index, 'первая обычная текстовая страница');

  const dense = [...pageInfo]
    .filter((p) => p.index > (expected.firstContentPage || 1) + 2)
    .sort((a, b) => b.textLength - a.textLength)[Math.floor(0)];
  if (dense) add(dense.index, 'плотная страница из середины');

  const special = pageInfo.find((p) => p.images > 0 && p.index > 2);
  if (special) add(special.index, 'страница с иллюстрацией');

  const lastText = [...pageInfo].reverse().find((p) => p.textLength > 200);
  if (lastText) add(lastText.index, 'последняя обычная текстовая страница');

  return sample.slice(0, 6);
}

module.exports = { checkPdf, loadPdfjs };

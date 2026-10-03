'use strict';

const { layoutText, tokenize, FONT } = require('./typeset');
const { mm } = require('../style');
const { chapterKicker, chapterLabel } = require('../model');
const { openerHeight, sceneHeight } = require('../signature');

/**
 * Превращение блоков главы в поток измеренных элементов, затем — пагинация.
 * Пагинация выполняется один раз: номера страниц для оглавления берутся
 * из её результата, повторных прогонов не требуется.
 */

/* ───────────────────────────── поток ───────────────────────────── */

function buildChapterFlow(ch, ctx) {
  const { style, geom, measure, assets } = ctx;
  const items = [];
  const lineStep = geom.lineStep;

  /* opener главы — компактный, всегда с новой страницы */
  const kicker = chapterKicker(ch);
  const titleTokens = ch.title ? tokenize([{ text: ch.title, b: true }], 'serif') : [];
  const headerH = (kicker ? style.kickerSize*1.5+(style.signature?14:5) : 0) +
    (style.signature ? openerHeight(geom.pageW-24)+5 : 2);
  const afterTitleGap = mm(style.openerGapMm);
  const titleBudget = geom.contentH-headerH-afterTitleGap-2*geom.lineStep;
  const layTitle = size => ch.title ? layoutText(titleTokens, {
    width:geom.contentW, size, firstIndent:0, justify:false,
    hyphenate:false, align:'center', measure,
  }) : [];
  let titleSize=style.chapterTitleSize, titleLines=layTitle(titleSize);
  // Обычные длинные названия уменьшаются; необычно длинные ниже переносятся.
  while(titleSize>12 && titleLines.length*titleSize*1.18>titleBudget) {
    titleSize=Math.max(12,titleSize-.5); titleLines=layTitle(titleSize);
  }
  const titleStep=titleSize*1.18;
  items.push({t:'opener',kicker,titleLines,titleSize,titleStep,headerH,afterTitleGap,
    h:headerH+titleLines.length*titleStep+afterTitleGap,newPage:true,chapterId:ch.id});

  let prevWasSystem = false;

  for (const block of ch.blocks) {
    switch (block.type) {
      case 'para': {
        const tokens = tokenize(block.runs, 'serif');
        if (!tokens.length) break;
        const lines = layoutText(tokens, {
          width: geom.contentW,
          size: style.bodySize,
          firstIndent: block.align ? 0 : geom.indent,
          justify: style.justify && !block.align,
          hyphenate: style.hyphenate,
          align: block.align || (style.justify ? 'justify' : 'left'),
          measure,
        });
        if (prevWasSystem) items.push({ t: 'gap', h: lineStep * 0.42 });
        items.push({
          t: 'lines',
          lines,
          size: style.bodySize,
          lineStep,
          fontDefault: FONT.serif,
          color: style.textColor,
          h: lines.length * lineStep,
          breakable: true,
        });
        prevWasSystem = false;
        break;
      }

      case 'heading': {
        const tokens = tokenize(block.runs, 'sans');
        const size = style.bodySize * 1.12;
        const lines = layoutText(tokens, {
          width: geom.contentW,
          size,
          firstIndent: 0,
          justify: false,
          hyphenate: false,
          align: 'left',
          measure,
        });
        items.push({ t: 'gap', h: lineStep * 0.7 });
        items.push({
          t: 'lines',
          lines,
          size,
          lineStep: size * 1.25,
          fontDefault: FONT.sansB,
          bold: true,
          color: style.textColor,
          h: lines.length * size * 1.25,
          breakable: false,
          keepWithNext: true,
        });
        items.push({ t: 'gap', h: lineStep * 0.28 });
        prevWasSystem = false;
        break;
      }

      case 'system': {
        const size = style.systemSize;
        const step = size * style.systemLineHeight;
        const pad = mm(style.systemPadMm);
        const iconColumn = style.signature ? 38 : 0;
        const inner = geom.contentW - pad * 2 - iconColumn;
        const laid = [];
        for (const runs of block.lines) {
          const tokens = tokenize(runs, style.signature ? 'serif' : 'sans');
          if (!tokens.length) {
            laid.push({ items: [], align: 'left' });
            continue;
          }
          const sub = layoutText(tokens, {
            width: inner,
            size,
            firstIndent: 0,
            justify: false,
            hyphenate: style.hyphenate,
            align: 'left',
            measure,
          });
          laid.push(...sub);
        }
        items.push({ t: 'gap', h: lineStep * 0.42 });
        items.push({
          t: 'system',
          lines: laid,
          size,
          lineStep: step,
          pad,
          inner,
          iconColumn,
          h: laid.length * step + pad * 2,
          breakable: true, // длинный блок разрешено переносить на следующую страницу
          table: !!block.table,
        });
        prevWasSystem = true;
        break;
      }

      case 'list': {
        const bullet = block.ordered ? null : '•';
        const laidItems = [];
        block.items.forEach((runs, idx) => {
          const prefix = block.ordered ? `${idx + 1}. ` : `${bullet} `;
          const tokens = tokenize([{ text: prefix }, ...runs], 'serif');
          const lines = layoutText(tokens, {
            width: geom.contentW - geom.indent,
            size: style.bodySize,
            firstIndent: 0,
            justify: false,
            hyphenate: style.hyphenate,
            align: 'left',
            measure,
          });
          laidItems.push(...lines);
        });
        items.push({ t: 'gap', h: lineStep * 0.35 });
        items.push({
          t: 'lines',
          lines: laidItems,
          size: style.bodySize,
          lineStep,
          fontDefault: FONT.serif,
          color: style.textColor,
          offsetX: geom.indent,
          h: laidItems.length * lineStep,
          breakable: true,
        });
        items.push({ t: 'gap', h: lineStep * 0.35 });
        prevWasSystem = false;
        break;
      }

      case 'sep': {
        items.push({ t: 'gap', h: lineStep * 0.9 });
        items.push({ t: 'sep', h: style.signature ? sceneHeight(geom.contentW) : 8 });
        items.push({ t: 'gap', h: lineStep * 0.9 });
        prevWasSystem = false;
        break;
      }

      case 'image': {
        const asset = assets.get(block.assetId);
        if (!asset) break;
        items.push({ t: 'gap', h: lineStep * 0.5 });
        items.push({
          t: 'image',
          assetId: block.assetId,
          alt: block.alt || 'Иллюстрация',
          srcW: block.w || null,
          srcH: block.h || null,
          h: 0, // вычисляется при пагинации: зависит от остатка страницы
          breakable: false,
        });
        items.push({ t: 'gap', h: lineStep * 0.5 });
        prevWasSystem = false;
        break;
      }

      default:
        break;
    }
  }

  return items;
}

/* ──────────────────────────── пагинация ──────────────────────────── */

/**
 * @returns {{pages:Array, chapterStarts:Map<string,number>}}
 *          pages[i] = { parts:[...] }, индексация с 0 от первой страницы контента
 */
function paginate(flowByChapter, ctx) {
  const { geom, style, imageSize } = ctx;
  const pages = [];
  const chapterStarts = new Map();

  let page = null;
  let y = geom.contentY;

  const newPage = (chapterId) => {
    page = { parts: [], chapterId: chapterId || null };
    pages.push(page);
    y = geom.contentY;
    return page;
  };

  const room = () => geom.contentBottom - y;

  for (const { chapter, items } of flowByChapter) {
    let first = true;

    for (const item of items) {
      if (item.t === 'opener') {
        newPage(chapter.id);
        chapterStarts.set(chapter.id, pages.length - 1);
        if(item.h<=geom.contentH) {
          page.parts.push({...item,y}); y+=item.h;
        } else {
          let rest=item.titleLines, firstChunk=true;
          while(rest.length) {
            const headerH=firstChunk?item.headerH:0;
            const capacity=Math.max(1,Math.floor((geom.contentH-headerH-item.afterTitleGap)/item.titleStep));
            const titleLines=rest.slice(0,capacity); rest=rest.slice(capacity);
            const h=headerH+titleLines.length*item.titleStep+(rest.length?0:item.afterTitleGap);
            page.parts.push({...item,titleLines,continued:!firstChunk,h,y}); y+=h;
            firstChunk=false;
            if(rest.length) newPage(chapter.id);
          }
        }
        first = false;
        continue;
      }

      if (!page) {
        newPage(chapter.id);
        if (first) chapterStarts.set(chapter.id, pages.length - 1);
      }

      if (item.t === 'gap') {
        // Пробел в начале страницы не нужен — иначе появляется пустота сверху.
        if (page.parts.length) y += item.h;
        continue;
      }

      if (item.t === 'sep') {
        if (room() < item.h) {
          newPage(chapter.id);
        }
        page.parts.push({ ...item, y });
        y += item.h;
        continue;
      }

      if (item.t === 'image') {
        const dims = imageSize(item.assetId, item.srcW, item.srcH);
        const maxW = geom.contentW;
        const fullH = geom.contentH;
        let w = maxW;
        let h = (dims.h / dims.w) * w;
        if (h > fullH) {
          h = fullH;
          w = (dims.w / dims.h) * h;
        }

        /* Крупная иллюстрация занимает отдельную страницу и центрируется по
           вертикали: иначе под ней остаётся пустая треть полосы. */
        const standalone = h > fullH * 0.55 || h > room() - 2;
        if (standalone) {
          if (page.parts.length) newPage(chapter.id);
          const x = geom.contentX + (geom.contentW - w) / 2;
          page.parts.push({ ...item, y: geom.contentY + (fullH - h) / 2, x, w, h, standalone: true });
          y = geom.contentBottom; // дальнейший текст идёт со следующей страницы
          continue;
        }

        const x = geom.contentX + (geom.contentW - w) / 2;
        page.parts.push({ ...item, y, x, w, h, standalone: false });
        y += h;
        continue;
      }

      // 'lines' и 'system' — разрезаемые блоки
      const stepOf = item.lineStep;
      const extra = item.t === 'system' ? item.pad * 2 : 0;
      const totalLines = item.lines.length;

      if (item.h <= room()) {
        page.parts.push({ ...item, y });
        y += item.h;
        continue;
      }

      if (!item.breakable) {
        if (item.h <= geom.contentH || page.parts.length) newPage(chapter.id);
        page.parts.push({ ...item, y });
        y += item.h;
        continue;
      }

      // Сколько строк влезает в остаток страницы
      let fit = Math.floor((room() - (item.t === 'system' ? item.pad : 0)) / stepOf);
      const MIN_HEAD = style.widowControl ? 2 : 1;
      const MIN_TAIL = style.widowControl ? 2 : 1;

      if (fit < MIN_HEAD || totalLines - fit < MIN_TAIL) {
        // Разрыв дал бы сироту или вдову — переносим блок целиком.
        if (page.parts.length) newPage(chapter.id);
        if (item.h <= room()) {
          page.parts.push({ ...item, y });
          y += item.h;
          continue;
        }
        fit = Math.floor((room() - (item.t === 'system' ? item.pad : 0)) / stepOf);
      }

      let rest = item.lines;
      let isFirstChunk = true;
      while (rest.length) {
        const capacity = Math.max(
          1,
          Math.floor((geom.contentBottom - y - (item.t === 'system' ? item.pad : 0)) / stepOf),
        );
        let take = Math.min(capacity, rest.length);
        if (style.widowControl && rest.length - take === 1 && take > 1) take -= 1; // не оставлять одну строку
        const chunk = rest.slice(0, take);
        rest = rest.slice(take);

        const chunkH = chunk.length * stepOf + (item.t === 'system' ? (isFirstChunk ? item.pad : 0) + (rest.length ? 0 : item.pad) : 0);
        page.parts.push({
          ...item,
          lines: chunk,
          y,
          h: chunkH,
          continued: !isFirstChunk,
          continuesOnNext: rest.length > 0,
        });
        y += chunkH;
        isFirstChunk = false;
        if (rest.length) newPage(chapter.id);
      }
    }
  }

  return { pages, chapterStarts };
}

module.exports = { buildChapterFlow, paginate };

'use strict';

const { chapterLabel, chapterKicker } = require('../model');
const { svgTitleMark, svgSceneBreak, svgSystemIcon, svgPanelCorner } = require('../signature');

/** Экранирование текста для XML. */
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Экранирование значения атрибута. */
const escAttr = esc;

/* ─────────────────────────── runs → inline XHTML ─────────────────────────── */

function runsToHtml(runs) {
  return (runs || [])
    .map((r) => {
      let html = esc(r.text);
      if (r.b) html = `<strong>${html}</strong>`;
      if (r.i) html = `<em>${html}</em>`;
      if (r.u) html = `<span class="u">${html}</span>`;
      if (r.link) html = `<a href="${escAttr(r.link)}">${html}</a>`;
      return html;
    })
    .join('');
}

/* ─────────────────────────────── контейнер ─────────────────────────────── */

function containerXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;
}

/* ──────────────────────────────── package ──────────────────────────────── */

function packageOpf(book, items, spine, modified) {
  const uid = `urn:uuid:${book.uuid}`;
  const manifest = items
    .map((it) => {
      const props = it.properties ? ` properties="${escAttr(it.properties)}"` : '';
      return `    <item id="${escAttr(it.id)}" href="${escAttr(it.href)}" media-type="${escAttr(it.type)}"${props}/>`;
    })
    .join('\n');

  const spineItems = spine.map((id) => `    <itemref idref="${escAttr(id)}"/>`).join('\n');
  const coverMeta = book.cover ? '\n    <meta name="cover" content="cover-image"/>' : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang="${escAttr(book.language)}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">${esc(uid)}</dc:identifier>
    <dc:title>${esc(book.title)}</dc:title>
    <dc:language>${esc(book.language)}</dc:language>
    <dc:creator id="creator">${esc(book.author || book.title)}</dc:creator>
    <dc:contributor id="translator">${esc(book.team)}</dc:contributor>
    <meta refines="#translator" property="role" scheme="marc:relators">trl</meta>
    <meta refines="#translator" property="file-as">${esc(book.team)}</meta>
    <dc:publisher>${esc(book.team)}</dc:publisher>
    <dc:description>${esc(`${book.title} — ${book.subtitle}. Перевод команды «${book.team}».`)}</dc:description>
    <dc:source>${esc(book.teamUrl)}</dc:source>
    <meta property="dcterms:modified">${esc(modified)}</meta>${coverMeta}
  </metadata>
  <manifest>
${manifest}
  </manifest>
  <spine>
${spineItems}
  </spine>
</package>
`;
}

/* ───────────────────────────────── nav ───────────────────────────────── */

/**
 * nav.xhtml существует и используется интерфейсом читалки,
 * но в spine не добавляется — отдельной видимой страницы оглавления нет.
 */
function navXhtml(book, entries) {
  const lis = entries
    .map((e) => `        <li><a href="${escAttr(e.href)}">${esc(e.label)}</a></li>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escAttr(book.language)}" lang="${escAttr(book.language)}">
<head>
  <meta charset="utf-8"/>
  <title>Оглавление</title>
</head>
<body>
  <nav epub:type="toc" id="toc" role="doc-toc">
    <h1>Оглавление</h1>
    <ol>
${lis}
    </ol>
  </nav>
  <nav epub:type="landmarks" id="landmarks" hidden="hidden">
    <h2>Ориентиры</h2>
    <ol>
      ${book.cover ? '<li><a epub:type="cover" href="text/cover.xhtml">Обложка</a></li>' : ''}
      <li><a epub:type="titlepage" href="text/title.xhtml">Титульная страница</a></li>
      <li><a epub:type="bodymatter" href="${escAttr(entries.length ? entries[0].href : 'text/title.xhtml')}">Начало книги</a></li>
    </ol>
  </nav>
</body>
</html>
`;
}

/* ───────────────────────────────── CSS ───────────────────────────────── */

function css(style) {
  return `@charset "utf-8";

/* Reflowable: жёстких размеров нет, всё тянется под экран читалки. */

html { font-size: 100%; }

body {
  margin: 0;
  padding: 0 0.6em;
  font-family: "PT Serif", Georgia, "Times New Roman", serif;
  font-size: 1em;
  line-height: ${style.lineHeight};
  color: ${style.textColor};
  widows: 2;
  orphans: 2;
  -webkit-hyphens: auto;
  hyphens: auto;
}

p {
  margin: 0;
  text-indent: 1.2em;
  text-align: justify;
}

p.noindent, p:first-of-type { text-indent: 0; }

h1.chapter-title {
  font-size: 1.45em;
  line-height: 1.22;
  font-weight: 700;
  margin: 0 0 0.9em 0;
  text-align: center;
  page-break-after: avoid;
  break-after: avoid;
}

p.kicker {
  font-family: "PT Serif", Georgia, serif;
  font-size: 0.72em;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: ${style.accent};
  margin: 0 0 0.35em 0;
  text-indent: 0;
  text-align: center;
}

.opener-mark { margin: 1em 0 0.8em; text-indent: 0; text-align: center; }
.opener-mark svg { width: 100%; max-width: 20em; height: auto; }

/* Системные окна, чаты, панели — отдельный структурный элемент. */
.sysblock {
  margin: 0.85em 0;
  padding: 0.6em 0.75em;
  background: ${style.systemBg};
  border: 1px solid ${style.systemBorder};
  border-radius: ${style.panel === 'rounded' ? '0.4em' : '0'};
  border-left: 2px solid ${style.accent};
  font-family: "${style.signature ? 'PT Serif' : 'PT Sans'}", Georgia, serif;
  font-size: 0.9em;
  line-height: 1.38;
  page-break-inside: auto;
  break-inside: auto;
}

.sysblock p {
  text-indent: 0;
  text-align: left;
  margin: 0;
}

.sysblock p + p { margin-top: 0.22em; }

.scene {
  margin: 1.1em 0;
  text-align: center;
  text-indent: 0;
  color: ${style.accent};
}

.scene svg { width: 100%; max-width: 22em; height: auto; }

/* Рамка главы следует потоку EPUB; читалка сохраняет своё разбиение страниц. */
.chapter.decorated { position: relative; padding: 0.8em 1.2em 1.6em; border-left: 1px solid ${style.systemBorder}; border-right: 1px solid ${style.systemBorder}; }
.chapter-corner { position: absolute; width: 1.6em; height: 1.6em; }
.chapter-corner svg, .panel-corner svg { width: 100%; height: 100%; }
.corner-tl { left: 0; top: 0; }
.corner-tr { right: 0; top: 0; transform: scaleX(-1); }
.corner-bl { left: 0; bottom: 0; transform: scaleY(-1); }
.corner-br { right: 0; bottom: 0; transform: scale(-1); }
.kicker-rule { width: 35%; height: 0; margin: 0.6em auto 1em; border-top: 1px solid ${style.accent}; }
.decorated .sysblock { position: relative; border: 1px solid ${style.accent}; border-left-width: 1px; padding: 0.9em 0.9em 0.9em 3.9em; }
.system-icon { position: absolute; left: 0.75em; top: 0.85em; width: 2.35em; height: 2.35em; }
.system-icon svg { width: 100%; height: 100%; }
.sysblock p:first-of-type strong { color: ${style.accent}; }
.panel-corner { position: absolute; width: 0.9em; height: 0.9em; }

figure {
  margin: 1.1em 0;
  padding: 0;
  text-align: center;
  page-break-inside: avoid;
  break-inside: avoid;
}

figure img,
img {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 0 auto;
}

/* Обложка — отдельная страница на всю высоту экрана. */
.cover-page {
  margin: 0;
  padding: 0;
  text-align: center;
}

.cover-page img {
  max-width: 100%;
  max-height: 100vh;
  height: auto;
  width: auto;
}

/* Титульная страница */
.titlepage { text-align: center; padding-top: 2.2em; }
.titlepage h1 { font-size: 1.9em; line-height: 1.2; margin: 0 0 0.6em 0; }
.titlepage .mark { margin: 0.8em 0 1.1em 0; }
.titlepage .mark svg { width: 90%; max-width: 20em; height: auto; }
.titlepage .edition {
  font-family: "PT Sans", "Segoe UI", Arial, sans-serif;
  font-weight: 700;
  font-size: 0.86em;
  color: ${style.accent};
  text-indent: 0;
  margin: 0 0 1.2em 0;
}
.titlepage .counts {
  font-family: "PT Sans", "Segoe UI", Arial, sans-serif;
  font-size: 0.82em;
  color: #55525a;
  text-indent: 0;
  margin: 0 0 0.3em 0;
}
.titlepage .by { margin-top: 2em; text-indent: 0; font-size: 0.95em; }

.about { text-align: center; padding-top: 2.5em; }
.about h1 { font-size: 1.35em; margin: 0 0 0.8em 0; }
.about p { text-indent: 0; text-align: center; margin: 0 0 0.55em 0; }
.about .label {
  font-family: "PT Sans", "Segoe UI", Arial, sans-serif;
  font-size: 0.82em;
  color: #6b6872;
}
.about .url { font-size: 0.82em; word-break: break-all; }

a { color: ${style.accent}; }
.u { text-decoration: underline; }

ul, ol { margin: 0.7em 0 0.7em 1.4em; padding: 0; }
li { margin: 0.18em 0; text-align: left; }
`;
}

/* ───────────────────────────── страницы книги ───────────────────────────── */

function page(book, { title, bodyClass, body, epubType }) {
  const typeAttr = epubType ? ` epub:type="${escAttr(epubType)}"` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escAttr(book.language)}" lang="${escAttr(book.language)}">
<head>
  <meta charset="utf-8"/>
  <title>${esc(title)}</title>
  <link rel="stylesheet" type="text/css" href="../css/style.css"/>
</head>
<body>
  <section class="${escAttr(bodyClass)}"${typeAttr}>
${body}
  </section>
</body>
</html>
`;
}

function coverXhtml(book, coverHref, coverAlt) {
  return page(book, {
    title: 'Обложка',
    bodyClass: 'cover-page',
    epubType: 'cover',
    body: `    <img src="${escAttr(coverHref)}" alt="${escAttr(coverAlt)}"/>`,
  });
}

function titleXhtml(book, style, counts) {
  const mark = style.signature ? `    <div class="mark">${svgTitleMark(style.accent, style.genre)}</div>\n` : '';
  const body = [
    `    <h1>${esc(book.title)}</h1>`,
    mark.trimEnd(),
    `    <p class="edition">${esc(book.subtitle || 'Полное издание')}</p>`,
    `    <p class="counts">${esc(counts.chapters)}</p>`,
    `    <p class="counts">${esc(counts.words)}</p>`,
    `    <p class="by">Перевод выполнен командой <a href="${escAttr(book.teamUrl)}">${esc(book.team)}</a></p>`,
  ]
    .filter(Boolean)
    .join('\n');
  return page(book, { title: book.title, bodyClass: 'titlepage', epubType: 'titlepage', body });
}

function aboutXhtml(book) {
  const body = [
    `    <h1>${esc(book.team)}</h1>`,
    `    <p>Перевод выполнен командой «${esc(book.team)}».</p>`,
    '    <p class="label">Официальная страница команды:</p>',
    `    <p class="url"><a href="${escAttr(book.teamUrl)}">${esc(book.teamUrl)}</a></p>`,
  ].join('\n');
  return page(book, { title: `О переводе — ${book.team}`, bodyClass: 'about', body });
}

/** Блоки главы → XHTML. */
function chapterBody(ch, style, hrefOfAsset) {
  const out = [];
  if (style.signature) for(const corner of ['tl','tr','bl','br']) out.push(`<span class="chapter-corner corner-${corner}">${svgPanelCorner(style.accent,style.genre)}</span>`);
  if (style.signature) out.push(`    <p class="opener-mark">${svgTitleMark(style.accent, style.genre)}</p>`);
  const kicker = chapterKicker(ch);
  if (kicker) out.push(`    <p class="kicker">${esc(kicker)}</p>`);
  if(style.signature && kicker) out.push('    <div class="kicker-rule"></div>');
  if (ch.title) out.push(`    <h1 class="chapter-title">${esc(ch.title)}</h1>`);
  else if (kicker) out.push(`    <h1 class="chapter-title">${esc(kicker)}</h1>`);

  let firstPara = true;
  for (const block of ch.blocks) {
    switch (block.type) {
      case 'para': {
        const cls = firstPara ? ' class="noindent"' : '';
        const alignment = ['left','center','right','justify'].includes(block.align) ? ` style="text-align:${block.align};text-indent:0"` : '';
        out.push(`    <p${cls}${alignment}>${runsToHtml(block.runs)}</p>`);
        firstPara = false;
        break;
      }
      case 'heading':
        out.push(`    <h2>${runsToHtml(block.runs)}</h2>`);
        firstPara = true;
        break;
      case 'system': {
        const lines = block.lines.map((runs) => `      <p>${runsToHtml(runs)}</p>`).join('\n');
        const decoration = style.signature ? `<span class="system-icon">${svgSystemIcon(style.accent,style.genre)}</span>` + ['tl','tr','bl','br'].map(c=>`<span class="panel-corner corner-${c}">${svgPanelCorner(style.accent,style.genre)}</span>`).join('') : '';
        out.push(`    <div class="sysblock" role="note">${decoration}\n${lines}\n    </div>`);
        firstPara = true;
        break;
      }
      case 'list': {
        const tag = block.ordered ? 'ol' : 'ul';
        const items = block.items.map((runs) => `      <li>${runsToHtml(runs)}</li>`).join('\n');
        out.push(`    <${tag}>\n${items}\n    </${tag}>`);
        firstPara = true;
        break;
      }
      case 'sep':
        out.push(`    <p class="scene">${style.signature ? svgSceneBreak(style.accent, style.genre) : '* * *'}</p>`);
        firstPara = true;
        break;
      case 'image': {
        const href = hrefOfAsset(block.assetId);
        if (href) {
          out.push(
            `    <figure>\n      <img src="${escAttr(href)}" alt="${escAttr(block.alt || 'Иллюстрация')}"/>\n    </figure>`,
          );
        }
        firstPara = true;
        break;
      }
      default:
        break;
    }
  }
  return out.join('\n');
}

function chapterXhtml(book, ch, style, hrefOfAsset) {
  return page(book, {
    title: chapterLabel(ch),
    bodyClass: style.signature ? 'chapter decorated' : 'chapter',
    epubType: 'chapter',
    body: chapterBody(ch, style, hrefOfAsset),
  });
}

module.exports = {
  esc,
  containerXml,
  packageOpf,
  navXhtml,
  css,
  coverXhtml,
  titleXhtml,
  aboutXhtml,
  chapterXhtml,
  runsToHtml,
};

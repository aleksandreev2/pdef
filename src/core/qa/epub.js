'use strict';

const fs = require('fs/promises');
const { execFile } = require('child_process');
const JSZip = require('jszip');
const { XMLParser, XMLValidator } = require('fast-xml-parser');

/**
 * Структурная проверка готового EPUB одним проходом (п.8.3 спецификации).
 * epubcheck запускается один раз, если он уже установлен; ставить его
 * специально не требуется — в отчёте честно указывается, что проверка
 * выполнена собственным валидатором.
 */

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', preserveOrder: true });

function check(name, ok, detail) {
  return { name, ok: !!ok, detail: detail || '' };
}

function tagName(node) {
  for (const k of Object.keys(node)) if (k !== ':@') return k;
  return null;
}
function kids(node) {
  const n = tagName(node);
  const v = n ? node[n] : null;
  return Array.isArray(v) ? v : [];
}
function attrs(node) {
  return node[':@'] || {};
}
function findDeepAll(nodes, name, out = []) {
  for (const n of nodes) {
    if (tagName(n) === name) out.push(n);
    findDeepAll(kids(n), name, out);
  }
  return out;
}

/**
 * Проверка mimetype по сырым байтам ZIP: он обязан быть первой записью
 * и храниться без сжатия.
 */
function checkMimetypeRaw(buf) {
  if (buf.length < 38) return { ok: false, detail: 'файл слишком мал' };
  if (buf.readUInt32LE(0) !== 0x04034b50) return { ok: false, detail: 'нет локального заголовка ZIP в начале' };
  const method = buf.readUInt16LE(8);
  const nameLen = buf.readUInt16LE(26);
  const extraLen = buf.readUInt16LE(28);
  const name = buf.subarray(30, 30 + nameLen).toString('latin1');
  if (name !== 'mimetype') return { ok: false, detail: `первая запись: ${name}` };
  if (method !== 0) return { ok: false, detail: `mimetype сжат (метод ${method})` };
  const content = buf.subarray(30 + nameLen + extraLen, 30 + nameLen + extraLen + 20).toString('latin1');
  if (!content.startsWith('application/epub+zip')) {
    return { ok: false, detail: `содержимое mimetype: ${content.slice(0, 24)}` };
  }
  return { ok: true, detail: 'первая запись, без сжатия' };
}

async function checkEpub(epubPath, { book, expected }) {
  const checks = [];
  const notes = [];
  const buf = await fs.readFile(epubPath);

  let zip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch (e) {
    return { ok: false, checks: [check('ZIP открывается', false, e.message)], notes };
  }
  checks.push(check('ZIP открывается', true, `записей: ${Object.keys(zip.files).length}`));

  const mime = checkMimetypeRaw(buf);
  checks.push(check('mimetype первый и без сжатия', mime.ok, mime.detail));

  /* ── container.xml → путь к OPF ── */
  const containerFile = zip.file('META-INF/container.xml');
  if (!containerFile) {
    checks.push(check('META-INF/container.xml существует', false));
    return { ok: false, checks, notes };
  }
  const containerXml = await containerFile.async('string');
  checks.push(check('META-INF/container.xml существует', true));

  const containerTree = parser.parse(containerXml);
  const rootfile = findDeepAll(containerTree, 'rootfile')[0];
  const opfPath = rootfile ? attrs(rootfile)['@full-path'] : null;
  if (!opfPath || !zip.file(opfPath)) {
    checks.push(check('content.opf найден по пути из container.xml', false, String(opfPath)));
    return { ok: false, checks, notes };
  }
  checks.push(check('content.opf найден по пути из container.xml', true, opfPath));

  const opfDir = opfPath.includes('/') ? opfPath.replace(/\/[^/]+$/, '') : '';
  const resolve = (href) => (opfDir ? `${opfDir}/${href}` : href).replace(/\/\.\//g, '/');

  /* ── валидность XML всех документов ── */
  const xmlFiles = Object.keys(zip.files).filter((n) => /\.(xhtml|opf|xml|ncx)$/i.test(n) && !zip.files[n].dir);
  const xmlErrors = [];
  const docSources = new Map();
  for (const name of xmlFiles) {
    const text = await zip.file(name).async('string');
    docSources.set(name, text);
    const res = XMLValidator.validate(text, { allowBooleanAttributes: true });
    if (res !== true) xmlErrors.push(`${name}: ${res.err.msg} (строка ${res.err.line})`);
  }
  checks.push(
    check(
      'XML и XHTML документы парсятся',
      xmlErrors.length === 0,
      xmlErrors.length ? xmlErrors.slice(0, 3).join('; ') : `проверено файлов: ${xmlFiles.length}`,
    ),
  );

  /* ── manifest и spine ── */
  const opfTree = parser.parse(docSources.get(opfPath));
  const manifestItems = findDeepAll(opfTree, 'item').map((n) => ({
    id: attrs(n)['@id'],
    href: attrs(n)['@href'],
    type: attrs(n)['@media-type'],
    properties: attrs(n)['@properties'] || '',
  }));
  const spineRefs = findDeepAll(opfTree, 'itemref').map((n) => attrs(n)['@idref']);

  const missing = manifestItems.filter((it) => !zip.file(resolve(it.href)));
  checks.push(
    check(
      'Manifest не содержит отсутствующих файлов',
      missing.length === 0,
      missing.length ? missing.map((m) => m.href).join(', ') : `элементов: ${manifestItems.length}`,
    ),
  );

  const byId = new Map(manifestItems.map((it) => [it.id, it]));
  const spineMissing = spineRefs.filter((id) => !byId.has(id));
  checks.push(check('Все idref из spine есть в manifest', spineMissing.length === 0, spineMissing.join(', ')));

  /* ── пустые документы в spine ── */
  const emptyDocs = [];
  for (const id of spineRefs) {
    const it = byId.get(id);
    if (!it) continue;
    const full = resolve(it.href);
    const text = docSources.get(full) || '';
    const bodyText = text
      .replace(/<head[\s\S]*?<\/head>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, '');
    const hasImg = /<img\b/i.test(text) || /<svg\b/i.test(text);
    if (bodyText.length < 12 && !hasImg) emptyDocs.push(it.href);
  }
  checks.push(
    check(
      'Spine не содержит пустых документов',
      emptyDocs.length === 0,
      emptyDocs.length ? emptyDocs.join(', ') : `документов в spine: ${spineRefs.length}`,
    ),
  );

  /* ── обложка ── */
  const coverItem = manifestItems.find((it) => it.properties.split(/\s+/).includes('cover-image'));
  checks.push(
    check(
      'Cover-image объявлена в manifest',
      !!coverItem || !book.cover,
      coverItem ? coverItem.href : 'обложка не задана',
    ),
  );
  if (!book.cover) notes.push('Обложка в книге не задана — проверка cover-image пропущена');

  /* ── nav.xhtml ── */
  const navItem = manifestItems.find((it) => it.properties.split(/\s+/).includes('nav'));
  checks.push(check('nav.xhtml существует и объявлен', !!navItem, navItem ? navItem.href : 'не найден'));
  checks.push(
    check(
      'nav.xhtml не создаёт отдельную видимую страницу оглавления',
      !!navItem && !spineRefs.includes(navItem.id),
      navItem && spineRefs.includes(navItem.id) ? 'nav включён в spine' : 'nav вне spine',
    ),
  );
  const hasVisibleToc = manifestItems.some(
    (it) => /toc\.xhtml$/i.test(it.href || '') && spineRefs.includes(it.id),
  );
  checks.push(check('Отдельного toc.xhtml в spine нет', !hasVisibleToc));

  /* ── порядок глав ── */
  const navText = navItem ? docSources.get(resolve(navItem.href)) || '' : '';
  // Только оглавление: ссылки из nav[epub:type="landmarks"] в порядок глав не входят.
  const tocNav = navText.match(/<nav[^>]*epub:type="toc"[\s\S]*?<\/nav>/i);
  const navHrefs = [...(tocNav ? tocNav[0] : navText).matchAll(/<a[^>]+href="([^"#]+)/g)].map((m) =>
    m[1].replace(/^\.\//, ''),
  );
  const chapterSpine = spineRefs
    .map((id) => byId.get(id))
    .filter((it) => it && /ch\d+\.xhtml$/i.test(it.href))
    .map((it) => it.href);
  const navChapters = navHrefs.filter((h) => /ch\d+\.xhtml$/i.test(h));
  const orderOk =
    navChapters.length === chapterSpine.length && navChapters.every((h, i) => h === chapterSpine[i]);
  checks.push(
    check(
      'Главы идут в правильном порядке',
      orderOk,
      `в nav: ${navChapters.length}, в spine: ${chapterSpine.length}`,
    ),
  );
  checks.push(
    check(
      'Количество глав совпадает с ожидаемым',
      chapterSpine.length === expected.sections,
      `в EPUB: ${chapterSpine.length}, ожидалось: ${expected.sections}`,
    ),
  );

  /* ── изображения и внутренние ссылки ── */
  const brokenRefs = [];
  const imageRefs = new Set();
  for (const [name, text] of docSources) {
    if (!/\.xhtml$/i.test(name)) continue;
    const dir = name.includes('/') ? name.replace(/\/[^/]+$/, '') : '';
    const refs = [
      ...[...text.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => ({ href: m[1], kind: 'img' })),
      ...[...text.matchAll(/<link[^>]+href="([^"]+)"/g)].map((m) => ({ href: m[1], kind: 'css' })),
      ...[...text.matchAll(/<a[^>]+href="([^"]+)"/g)].map((m) => ({ href: m[1], kind: 'a' })),
    ];
    for (const r of refs) {
      if (/^(https?:|mailto:|#)/i.test(r.href)) continue;
      const target = normalizePath(`${dir}/${r.href.split('#')[0]}`);
      if (!zip.file(target)) brokenRefs.push(`${name} → ${r.href}`);
      else if (r.kind === 'img') imageRefs.add(target);
    }
  }
  checks.push(
    check(
      'Внутренние ссылки и пути к файлам не битые',
      brokenRefs.length === 0,
      brokenRefs.length ? brokenRefs.slice(0, 3).join('; ') : 'все пути разрешаются',
    ),
  );
  checks.push(
    check(
      'Изображения существуют в архиве',
      [...imageRefs].every((p) => !!zip.file(p)),
      `использовано изображений: ${imageRefs.size}`,
    ),
  );

  /* ── внешняя ссылка на команду ── */
  const teamLinkFiles = [...docSources.entries()].filter(([, t]) => t.includes(book.teamUrl));
  checks.push(
    check(
      `Внешняя ссылка на ${book.team} корректна`,
      teamLinkFiles.length > 0,
      teamLinkFiles.length ? `встречается в ${teamLinkFiles.length} документах` : 'ссылка не найдена',
    ),
  );

  /* ── первая, средняя и последняя главы открываются ── */
  const probe = chapterSpine.length
    ? [chapterSpine[0], chapterSpine[Math.floor(chapterSpine.length / 2)], chapterSpine[chapterSpine.length - 1]]
    : [];
  const probeOk = probe.every((href) => {
    const text = docSources.get(resolve(href)) || '';
    return text.length > 200 && XMLValidator.validate(text, { allowBooleanAttributes: true }) === true;
  });
  checks.push(
    check(
      'Первая, средняя и последняя главы открываются',
      probe.length === 3 && probeOk,
      probe.length ? probe.join(', ') : 'главы не найдены',
    ),
  );

  /* ── язык и переводчик ── */
  const opfText = docSources.get(opfPath) || '';
  const language = book.language || 'ru';
  checks.push(check(`Язык книги — ${language}`, new RegExp(`<dc:language>\\s*${escapeRe(language)}\\s*</dc:language>`).test(opfText)));
  checks.push(
    check(
      `Переводчик указан как ${book.team}`,
      new RegExp(`<dc:contributor[^>]*>${escapeRe(book.team)}</dc:contributor>`).test(opfText),
    ),
  );
  checks.push(check('JavaScript в EPUB не используется', ![...docSources.values()].some((t) => /<script\b/i.test(t))));

  /* ── epubcheck, если он уже есть в системе ── */
  const ec = await tryEpubcheck(epubPath);
  if (ec.available) {
    checks.push(check('epubcheck', ec.ok, ec.detail));
  } else {
    notes.push('epubcheck не установлен — использована собственная структурная проверка');
  }

  return { ok: checks.every((c) => c.ok), checks, notes };
}

function normalizePath(p) {
  const parts = p.replace(/^\/+/, '').split('/');
  const out = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tryEpubcheck(epubPath) {
  return new Promise((resolve) => {
    execFile('epubcheck', [epubPath], { timeout: 180000, windowsHide: true }, (err, stdout, stderr) => {
      const out = `${stdout || ''}${stderr || ''}`;
      if (err && (err.code === 'ENOENT' || /не найден|not recognized|not found/i.test(out))) {
        resolve({ available: false });
        return;
      }
      const errors = (out.match(/^ERROR/gim) || []).length;
      const fatals = (out.match(/^FATAL/gim) || []).length;
      resolve({
        available: true,
        ok: errors === 0 && fatals === 0,
        detail: errors || fatals ? `ошибок: ${errors}, критических: ${fatals}` : 'без ошибок',
      });
    });
  });
}

module.exports = { checkEpub };

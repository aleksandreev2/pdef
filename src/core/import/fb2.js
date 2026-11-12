'use strict';

const sax = require('sax');
const iconv = require('iconv-lite');
const { makeRun, runsText, KIND } = require('../model');
const { readFb2Glyph } = require('../fb2-glyphs');
const { ATTRIBUTION_ID, ATTRIBUTION_TEXT } = require('../credits');

const CHUNK_SIZE = 32 * 1024;
const ENCODING_PROBE = 300;
const EXT_BY_MIME = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
  'image/webp': 'webp', 'image/bmp': 'bmp',
};

function detectEncoding(buffer) {
  if ((buffer[0] === 0xff && buffer[1] === 0xfe) || (buffer[0] === 60 && buffer[1] === 0)) return 'utf16le';
  if ((buffer[0] === 0xfe && buffer[1] === 0xff) || (buffer[0] === 0 && buffer[1] === 60)) return 'utf16be';
  const declaration = buffer.subarray(0, ENCODING_PROBE).toString('ascii').match(/^\s*<\?xml\s+[^?]*?\bencoding\s*=\s*["']([^"']+)/i);
  return declaration?.[1] || 'utf8';
}

function decoderFor(encoding) {
  if (!iconv.encodingExists(encoding)) throw new Error('Неизвестная кодировка FB2: ' + encoding);
  const normalized = encoding.toLowerCase().replace(/[-_]/g, '');
  if (['utf8', 'utf16le', 'utf16be'].includes(normalized)) {
    const label = { utf8: 'utf-8', utf16le: 'utf-16le', utf16be: 'utf-16be' }[normalized];
    const decoder = new TextDecoder(label, { fatal: true });
    return {
      write: chunk => decoder.decode(chunk, { stream: true }),
      end: () => decoder.decode(),
    };
  }
  return iconv.getDecoder(encoding);
}

function nodeText(node) {
  if (!node) return '';
  if (node.name === '#text') return node.value;
  if (node.name === 'image') return readFb2Glyph(node.attrs.href) || '';
  return node.children.map(nodeText).join('');
}

function paragraphs(node, style) {
  const { name, attrs, children } = node;
  if (name === 'image') return [{ image: { href: attrs.href, alt: attrs.title || '' } }];
  if (name === 'empty-line') return [];
  if (name === 'title') return children.flatMap(child => paragraphs(child, 'Heading1'));
  if (['p', 'v', 'subtitle', 'text-author'].includes(name)) {
    const out = [];
    let runs = [];
    const flush = () => {
      if (runsText(runs).trim()) out.push({ runs, ...(style ? { style } : {}), ...(name === 'subtitle' ? { style: 'Heading3' } : {}) });
      runs = [];
    };
    function visit(child, fmt) {
      if (child.name === 'image') {
        const href = child.attrs.href;
        const glyph = readFb2Glyph(href);
        if (glyph) runs.push({ ...makeRun(glyph, fmt), fb2GlyphHref: href });
        else {
          flush();
          out.push(...paragraphs(child));
        }
        return;
      }
      if (child.name === '#text') {
        runs.push(makeRun(child.value, fmt));
        return;
      }
      const next = { ...fmt };
      if (child.name === 'strong') next.b = true;
      if (child.name === 'emphasis') next.i = true;
      if (child.name === 'a' && /^(https?:|mailto:)/i.test(child.attrs.href || '')) next.link = child.attrs.href;
      for (const nested of child.children) visit(nested, next);
    }
    visit(node, style ? { b: true } : {});
    flush();
    return out;
  }
  if (name === 'table') {
    const lines = children.filter(child => child.name === 'tr').map(row => [makeRun(row.children.map(nodeText).join('  ·  '))]);
    return lines.length ? [{ table: true, lines }] : [];
  }
  if (name === '#text') return node.value.trim() ? [{ runs: [makeRun(node.value)] }] : [];
  return children.flatMap(child => paragraphs(child, style));
}

function binaryDecoder(attrs) {
  const mime = String(attrs['content-type'] || '').toLowerCase();
  const ext = EXT_BY_MIME[mime];
  const parts = [];
  let rest = '';
  let invalid = false;
  return {
    write(value) {
      if (!ext || invalid) return;
      const input = rest + value.replace(/\s+/g, '');
      if (/[^a-z\d+/=]/i.test(input)) {
        invalid = true;
        return;
      }
      const end = input.length - (input.length % 4);
      if (end) parts.push(Buffer.from(input.slice(0, end), 'base64'));
      rest = input.slice(end);
    },
    end() {
      if (rest && !invalid) parts.push(Buffer.from(rest, 'base64'));
      const data = ext && !invalid ? Buffer.concat(parts) : null;
      return { mime, ext, data, invalid };
    },
  };
}

function makeReader(encoding, addAsset) {
  const parser = sax.parser(true, { xmlns: true, strictEntities: true });
  const stack = [];
  const bodies = [];
  const binaries = new Map();
  const warnings = new Set();
  let description;
  let sawRoot = false;
  let nextGroup = 0;

  const malformed = message => new Error('Повреждённый XML FB2: ' + message);
  parser.onerror = e => { throw malformed(e.message); };
  parser.onopentag = tag => {
    const attrs = Object.fromEntries(Object.values(tag.attributes).map(a => [a.local, a.value]));
    const name = tag.local;
    const parent = stack.at(-1);
    if (!parent) {
      if (sawRoot) throw malformed('найдено несколько корневых элементов');
      if (name !== 'FictionBook') throw new Error('Не найден корневой элемент FictionBook');
      sawRoot = true;
      stack.push({ kind: 'root' });
    } else if (parent.kind === 'binary') {
      throw malformed('в двоичном ресурсе найден XML-элемент');
    } else if (parent.kind === 'root' && name === 'binary') {
      stack.push({ kind: 'binary', id: attrs.id, decoder: binaryDecoder(attrs) });
    } else if ((parent.kind === 'root' && name === 'body') || (parent.kind === 'section' && name === 'section')) {
      stack.push({ kind: 'section', name, attrs, group: nextGroup++, siblings: parent.group, entries: [] });
    } else if (parent.kind === 'section' || parent.kind === 'node' || (parent.kind === 'root' && name === 'description')) {
      stack.push({ kind: 'node', node: { name, attrs, children: [] } });
    } else {
      stack.push({ kind: 'ignored' });
    }
  };

  function onText(value) {
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) throw malformed('недопустимый символ');
    const frame = stack.at(-1);
    if (frame?.kind === 'binary') frame.decoder.write(value);
    else if (frame?.kind === 'node') {
      const children = frame.node.children;
      const last = children.at(-1);
      if (last?.name === '#text') last.value += value;
      else children.push({ name: '#text', value });
    } else if (frame?.kind === 'section' && value.trim()) {
      frame.entries.push({ raw: [{ runs: [makeRun(value)] }] });
    }
  }
  parser.ontext = parser.oncdata = onText;

  parser.onclosetag = () => {
    const frame = stack.pop();
    const parent = stack.at(-1);
    if (frame.kind === 'binary') binaries.set(frame.id, frame.decoder.end());
    else if (frame.kind === 'section') {
      if (frame.name === 'body') bodies.push(frame);
      else parent.entries.push({ section: frame });
    } else if (frame.kind === 'node') {
      if (parent.kind === 'node') parent.node.children.push(frame.node);
      else if (parent.kind === 'root') description ??= frame.node;
      else {
        const raw = paragraphs(frame.node);
        if (frame.node.name === 'title' && !parent.title) {
          parent.title = nodeText(frame.node);
          // A title can contain multiple paragraphs and embedded glyphs.
          parent.title = frame.node.children.filter(child => child.name !== '#text').map(nodeText).join(' ').trim() || parent.title.trim();
          parent.headingParas = raw;
        }
        const creditText = parent.attrs.id === ATTRIBUTION_ID && frame.node.name === 'p' ? nodeText(frame.node) : null;
        parent.entries.push({ raw, creditText });
      }
    }
  };

  const find = (node, name) => node?.children.find(child => child.name === name);
  const cache = new Map();
  function image(href) {
    const id = String(href || '').replace(/^#/, '');
    if (cache.has(id)) return cache.get(id);
    const binary = binaries.get(id);
    if (!binary) warnings.add('Не найдено изображение FB2: ' + id);
    else if (!binary.ext) warnings.add('Не поддержан тип изображения FB2: ' + binary.mime);
    else if (binary.invalid) warnings.add('Повреждённое изображение FB2: ' + id);
    else if (!binary.data.length) warnings.add('Пустое изображение FB2: ' + id);
    else {
      const assetId = addAsset(binary.data, binary.ext, binary.mime);
      cache.set(id, assetId);
      return assetId;
    }
    cache.set(id, null);
    return null;
  }

  function resolveImages(raw) {
    return raw.filter(para => {
      if (para.image) {
        const assetId = image(para.image.href);
        if (!assetId) return false;
        para.image = { assetId, alt: para.image.alt };
      }
      if (para.runs?.some(run => run.fb2GlyphHref)) {
        para.runs = para.runs.filter(run => {
          if (!run.fb2GlyphHref) return true;
          if (binaries.has(run.fb2GlyphHref.slice(1))) {
            delete run.fb2GlyphHref;
            return true;
          }
          image(run.fb2GlyphHref);
          return false;
        });
        return runsText(para.runs).trim().length > 0;
      }
      return true;
    });
  }

  const sections = [];
  function section(frame, fallbackTitle, kind) {
    const label = frame.title || fallbackTitle;
    const emit = rawParas => sections.push({
      title: label, kind, rawParas, id: frame.attrs.id,
      ...(frame.headingParas ? { headingParas: frame.headingParas } : {}),
      ...(frame.title && frame.name === 'section' ? {
        nativeTitle: true, siblingGroup: frame.siblings,
      } : {}),
    });
    let raw = [];
    let lastChild;
    for (const entry of frame.entries) {
      const child = entry.section;
      if (!child) {
        raw.push(...resolveImages(entry.raw));
        continue;
      }
      if (child.attrs.id === ATTRIBUTION_ID && child.entries.map(item => item.creditText).filter(value => value != null).join('\n') === ATTRIBUTION_TEXT) continue;
      if (lastChild) {
        lastChild.rawParas.push(...raw);
        raw = [];
      }
      if (raw.some(p => p.image || p.table || (p.runs && p.style !== 'Heading1'))) {
        emit(raw);
        raw = [];
      }
      const headingOnly = raw;
      raw = [];
      const before = sections.length;
      section(child, '', kind);
      if (sections[before]) {
        const target = sections[before].rawParas;
        const at = target.findIndex(p => p.style !== 'Heading1');
        target.splice(at < 0 ? target.length : at, 0, ...headingOnly.map(p => ({ ...p, style: 'Heading3' })));
        lastChild = sections.at(-1);
      }
    }
    if (lastChild) lastChild.rawParas.push(...raw);
    else if (raw.length) emit(raw);
  }

  return {
    write(chunk) {
      for (let i = 0; i < chunk.length; i += CHUNK_SIZE) parser.write(chunk.slice(i, i + CHUNK_SIZE));
    },
    end() {
      parser.close();
      if (!sawRoot) throw new Error('Не найден корневой элемент FictionBook');
      const info = find(description, 'title-info');
      const title = nodeText(find(info, 'book-title')).trim();
      const author = info?.children.filter(node => node.name === 'author').map(node =>
        ['first-name', 'middle-name', 'last-name'].map(name => nodeText(find(node, name)).trim()).filter(Boolean).join(' ') ||
        nodeText(find(node, 'nickname')).trim()
      ).filter(Boolean).join('; ') || '';
      const language = nodeText(find(info, 'lang')).trim();
      const coverNode = find(find(info, 'coverpage'), 'image');
      const coverAssetId = coverNode ? image(coverNode.attrs.href) : null;
      for (const body of bodies) section(body, title, body.attrs.name === 'notes' ? KIND.EXTRA : undefined);
      if (!sections.length) throw new Error('В FB2 не найдено содержимое книги');
      return { sections, title, author, language, coverAssetId, encoding, warnings: [...warnings] };
    },
  };
}

function readWithDecoder(encoding, addAsset) {
  const decoder = decoderFor(encoding);
  const reader = makeReader(encoding, addAsset);
  return {
    write(buffer) {
      for (let i = 0; i < buffer.length; i += CHUNK_SIZE) {
        reader.write(decoder.write(buffer.subarray(i, i + CHUNK_SIZE)));
      }
    },
    end() {
      reader.write(decoder.end() || '');
      return reader.end();
    },
  };
}

function parseFb2(buffer, addAsset) {
  const reader = readWithDecoder(detectEncoding(buffer), addAsset);
  reader.write(buffer);
  return reader.end();
}

function parseFb2Xml(xml, addAsset) {
  const reader = makeReader('utf8', addAsset);
  reader.write(xml);
  return reader.end();
}

async function parseFb2Stream(chunks, addAsset) {
  const initial = [];
  let pending = 0;
  let reader;
  function start() {
    const probe = Buffer.concat(initial.map(chunk => chunk.subarray(0, ENCODING_PROBE)), Math.min(pending, ENCODING_PROBE));
    reader = readWithDecoder(detectEncoding(probe), addAsset);
    for (const chunk of initial) reader.write(chunk);
    initial.length = 0;
  }
  for await (const chunk of chunks) {
    if (reader) reader.write(chunk);
    else if (chunk.length) {
      initial.push(chunk);
      pending += chunk.length;
      if (pending >= ENCODING_PROBE) start();
    }
  }
  if (!reader && pending) start();
  return reader ? reader.end() : null;
}

module.exports = { parseFb2, parseFb2Stream, parseFb2Xml };

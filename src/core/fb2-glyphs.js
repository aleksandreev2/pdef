'use strict';

const supplementary = /[\u{10000}-\u{10ffff}]/u;
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const glyphPrefix = 'pdef-glyph-';

function readFb2Glyph(href) {
  const match = /^#pdef-glyph-([0-9a-f]{2,6}(?:-[0-9a-f]{2,6})*)$/i.exec(href || '');
  if (!match) return null;
  const points = match[1].split('-').map(code => parseInt(code, 16));
  if (points.some(cp => cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff))) return null;
  const value = points.map(cp => String.fromCodePoint(cp)).join('');
  return supplementary.test(value) && [...graphemes.segment(value)].length === 1 ? value : null;
}

function createGlyphImages(fonts = {}) {
  const resources = new Map();
  const missing = new Set();
  let doc, measurer;

  function render(value) {
    if (!fonts.serif || !fonts.sans) return null;
    if (!doc) {
      const PDFDocument = require('pdfkit');
      const { createMeasurer } = require('./pdf/typeset');
      doc = new PDFDocument({ autoFirstPage: false });
      measurer = createMeasurer(doc, fonts);
    }
    let unavailable = false;
    const parts = measurer.parts(value, 'serif', () => { unavailable = true; });
    if (unavailable || parts.length !== 1) return null;
    const { glyphs, positions } = doc.font(parts[0].fontKey)._font.font.layout(value);
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    let x = 0, y = 0;
    const paths = [];
    for (let index = 0; index < glyphs.length; index += 1) {
      const glyph = glyphs[index];
      const { xOffset, yOffset, xAdvance, yAdvance } = positions[index];
      const gx = x + xOffset;
      const gy = -(y + yOffset);
      const d = glyph.path.toSVG();
      if (d) {
        const { minX, maxX, minY, maxY } = glyph.bbox;
        left = Math.min(left, gx + minX);
        right = Math.max(right, gx + maxX);
        top = Math.min(top, gy - maxY);
        bottom = Math.max(bottom, gy - minY);
        paths.push(`<path d="${d}" transform="translate(${gx} ${gy}) scale(1 -1)"/>`);
      }
      x += xAdvance;
      y += yAdvance;
    }
    if (!paths.length || bottom <= top || right <= left) return null;
    const pad = (bottom - top) * 0.08;
    const view = [left - pad, top - pad, right - left + 2 * pad, bottom - top + 2 * pad];
    const width = Math.min(44, Math.max(1, Math.ceil(19 * view[2] / view[3])));
    const outlines = paths.join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="19" viewBox="${view.join(' ')}"><g fill="none" stroke="#fff2d6" stroke-width="${pad}" stroke-linejoin="round">${outlines}</g><g fill="#252736">${outlines}</g></svg>`;
    const { Resvg } = require('@resvg/resvg-js');
    return new Resvg(svg).render().asPng();
  }

  function markup(value, escape, imageMarkup, accepts = () => true) {
    if (!supplementary.test(value)) return escape(value);
    let text = '';
    let start = 0;
    for (const { segment, index } of graphemes.segment(value)) {
      if (!supplementary.test(segment) || !accepts(segment)) continue;
      text += escape(value.slice(start, index));
      start = index + segment.length;
      const codes = [...segment].map(char => char.codePointAt(0).toString(16));
      const id = glyphPrefix + codes.join('-');
      if (!resources.has(id) && !missing.has(id)) {
        const data = render(segment);
        if (data) resources.set(id, { id, data, mime: 'image/png' });
        else missing.add(id);
      }
      text += imageMarkup(resources.get(id), segment, codes);
    }
    return text + escape(value.slice(start));
  }

  return { markup, resources, missing };
}

function createFb2Glyphs(fonts) {
  const glyphs = createGlyphImages(fonts);
  return { ...glyphs, markup: (value, escape = text => text) => glyphs.markup(value, escape, (resource, _segment, codes) => {
    const label = codes.map(code => 'U+' + code.toUpperCase()).join(' ');
    return resource ? `<image l:href="#${resource.id}" alt="${label}"/>` : `[${label}]`;
  }) };
}

module.exports = { createFb2Glyphs, createGlyphImages, readFb2Glyph };

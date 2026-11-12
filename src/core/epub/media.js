'use strict';

const { Resvg } = require('@resvg/resvg-js');
const { createGlyphImages } = require('../fb2-glyphs');

const emoji = /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u;

function ornamentId(part) { return `pdef-ornament-${part}`; }
function imageHref(id) { return `images/${id}.png`; }

function ornamentPng(svg) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: 800 }, font: { loadSystemFonts: false } }).render().asPng();
}

function createEpubGlyphs(fonts) {
  const glyphs = createGlyphImages(fonts);
  return { ...glyphs, markup: (value, escape) => glyphs.markup(value, escape, (resource, segment) => {
    return resource ? `<img class="pdef-emoji" src="../${imageHref(resource.id)}" alt="${escape(segment)}"/>` : escape(segment);
  }, segment => emoji.test(segment)) };
}

module.exports = { ornamentId, imageHref, ornamentPng, createEpubGlyphs };

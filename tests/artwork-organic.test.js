'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Resvg } = require('@resvg/resvg-js');
const { XMLValidator } = require('fast-xml-parser');

const sizes = { opener: [1000, 280], divider: [1000, 160], frame: [1000, 1778], icon: [100, 100], corner: [100, 100], folio: [1000, 100] };
const genres = ['fantasy', 'horror', 'romance', 'historical', 'cultivation'];
function render(markup, [w, h]) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${markup}</svg>`;
  assert.equal(XMLValidator.validate(svg), true, 'Artwork must remain valid XML');
  return new Resvg(svg).render();
}
function alphaIn(image, x0, y0, x1, y1) {
  const pixels = image.pixels;
  let amount = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) amount += pixels[(y * image.width + x) * 4 + 3];
  return amount;
}

test('all organic parts produce self-contained, visible vector artwork', () => {
  const { artwork } = require('../src/core/artwork/organic');
  const renderedOpeners = new Set();
  for (const genre of genres) {
    for (const [part, dimensions] of Object.entries(sizes)) {
      const markup = artwork(genre, part, '#39715c');
      assert.ok(markup.length > 0, `${genre}/${part} is missing`);
      assert.doesNotMatch(markup, /<(?:svg|text|image|foreignObject|filter|style)\b|(?:href|url\(|currentColor)/i);
      const rendered = render(markup, dimensions);
      assert.ok(alphaIn(rendered, 0, 0, ...dimensions) > 10000, `${genre}/${part} must be visible`);
      if (part === 'opener') renderedOpeners.add(rendered.asPng().toString('base64'));
    }
  }
  assert.equal(renderedOpeners.size, genres.length, 'Each genre must have its own visual identity');
});

test('page frames leave the reading area clear and folios leave the page number clear', () => {
  const { artwork } = require('../src/core/artwork/organic');
  for (const genre of genres) {
    const frame = render(artwork(genre, 'frame', '#8a5328'), sizes.frame);
    assert.equal(alphaIn(frame, 90, 320, 910, 1640), 0, `${genre} frame overlaps chapter text`);
    const folio = render(artwork(genre, 'folio', '#8a5328'), sizes.folio);
    assert.equal(alphaIn(folio, 430, 0, 570, 100), 0, `${genre} folio overlaps page number`);
  }
});

test('accent colours are applied without permitting markup injection', () => {
  const { artwork } = require('../src/core/artwork/organic');
  for (const genre of genres) {
    const custom = artwork(genre, 'icon', '#123abc');
    assert.match(custom, /#123abc/i);
    const malformed = artwork(genre, 'icon', '\"/><script>alert(1)</script>');
    assert.doesNotMatch(malformed, /script|alert/);
    render(malformed, sizes.icon);
  }
});

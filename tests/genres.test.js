'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { clampStyle } = require('../src/core/style');
const { svgSceneBreak } = require('../src/core/signature');
const { GENRES } = require('../src/core/genres');
const { chapterXhtml, navXhtml } = require('../src/core/epub/templates');

const genres = ['fantasy', 'dark-fantasy', 'horror', 'sci-fi', 'litrpg', 'romance', 'historical', 'thriller', 'cultivation', 'regression'];
test('all ten genres produce distinct vector scene ornaments', () => {
  const ornaments = genres.map(genre => svgSceneBreak('#765432', genre));
  assert.equal(new Set(ornaments).size, 10);
  for (const svg of ornaments) {
    assert.ok(svg.includes('<path'));
    assert.ok(!svg.includes('<text'));
  }
});
test('EPUB without a cover does not link to a nonexistent cover page', () => {
  const nav = navXhtml({ uuid: 'sample', title: 'Книга', language: 'ru', cover: null }, [{ href: 'text/ch001.xhtml', label: 'Глава 1' }]);
  assert.ok(!nav.includes('text/cover.xhtml'));
});
test('genre presets set note colors and reject unknown genre names', () => {
  const romance = clampStyle({ genre: 'romance' });
  const scifi = clampStyle({ genre: 'sci-fi' });
  assert.notEqual(romance.systemBg, scifi.systemBg);
  assert.equal(clampStyle({ genre: '<script>' }).genre, 'fantasy');
  assert.equal(clampStyle({ genre: 'romance', accent: '#123456' }).accent, '#123456');
});
test('EPUB preserves genre artwork as inline vectors and plain separators when disabled', () => {
  const chapter = { kind: 'chapter', number: 1, title: 'Chapter name', blocks: [{ type: 'para', runs: [{ text: 'Before the scene.' }] }, { type: 'sep', text: '──✦──' }, { type: 'para', runs: [{ text: 'After the scene.' }] }] };
  for (const { id: genre } of GENRES) for (const signature of [true, false]) {
    const html = chapterXhtml({ language: 'ru' }, chapter, clampStyle({ genre, signature, accent: '#99784d' }), () => '');
    assert.doesNotMatch(html, /<img\b|opener-mark/);
    assert.ok(!html.includes(chapter.blocks[1].text));
    assert.match(html, /<span class="chapter-name">Chapter name<\/span>/);
    if (signature) {
      assert.match(html, /<span class="chapter-ornament"[^>]*><svg[^>]+height="2.5em"/);
      assert.match(html, /<p class="scene"><svg[^>]+height="1.8em"/);
      assert.match(html, /stroke="#99784d"/);
      assert.doesNotMatch(html, /currentColor|<image\b/i);
    } else {
      assert.doesNotMatch(html, /<svg\b/);
      assert.match(html, /Before the scene\.<\/p>\s*<p class="scene">\* \* \*<\/p>\s*<p class="noindent">After the scene\./);
    }
  }
});

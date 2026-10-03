'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { clampStyle } = require('../src/core/style');
const { svgSceneBreak } = require('../src/core/signature');
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
test('EPUB uses the chosen ornament in place of source separator characters', () => {
  const chapter = { kind: 'chapter', number: 1, title: 'Начало', blocks: [{ type: 'para', runs: [{ text: 'До перехода.' }] }, { type: 'sep', text: '──────────' }, { type: 'para', runs: [{ text: 'После перехода.' }] }] };
  const fantasy = chapterXhtml({ language: 'ru' }, chapter, clampStyle({ genre: 'fantasy' }), () => '');
  const romance = chapterXhtml({ language: 'ru' }, chapter, clampStyle({ genre: 'romance' }), () => '');
  assert.ok(!fantasy.includes('──────────'));
  assert.ok(fantasy.includes('До перехода.') && fantasy.includes('После перехода.'));
  assert.notEqual(fantasy, romance);
});

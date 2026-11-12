'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  PDEF_NAME,
  PDEF_URL,
  DEVELOPER_NAME,
  DEVELOPER_URL,
  DEVELOPER_TEAM,
  ATTRIBUTION_TEXT,
} = require('../src/core/credits');
const { aboutXhtml, titleXhtml, css } = require('../src/core/epub/templates');
const { clampStyle } = require('../src/core/style');

test('PDeF authorship credit keeps canonical developer details', () => {
  assert.equal(PDEF_NAME, 'PDeF');
  assert.equal(PDEF_URL, 'https://github.com/aleksandreev2/pdef');
  assert.equal(DEVELOPER_NAME, 'dollar');
  assert.equal(DEVELOPER_URL, 'https://ranobelib.me/ru/user/726236');
  assert.equal(DEVELOPER_TEAM, 'Дом Некроманта');
  assert.equal(
    ATTRIBUTION_TEXT,
    'Документ создан с помощью PDeF.\nРазработчик — dollar\nвладелец команды «Дом Некроманта».',
  );
});

test('EPUB about page contains styled clickable PDeF authorship credit', () => {
  const book = {
    title: 'Тест',
    language: 'ru',
    team: 'Другая команда',
    teamUrl: 'https://example.test/translators',
  };
  const stylesheet = css(clampStyle({}));
  for (const html of [aboutXhtml(book), titleXhtml(book, clampStyle({}), { chapters: '1 глава', words: '10 слов' })]) {
    assert.ok(html.includes('class="pdef-credit"'));
    assert.ok(html.includes(`href="${PDEF_URL}"`));
    assert.ok(html.includes(`href="${DEVELOPER_URL}"`));
    assert.ok(html.includes('Документ создан с помощью'));
    assert.match(html, /владелец команды «<a href="https:\/\/ranobelib\.me\/ru\/team\/11969--dom-nekromanta">Дом Некроманта<\/a>»\./);
  }
  assert.ok(stylesheet.includes('.about .pdef-credit'));
});

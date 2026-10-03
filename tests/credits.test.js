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
const { aboutXhtml, css } = require('../src/core/epub/templates');
const { clampStyle } = require('../src/core/style');

test('PDeF authorship credit keeps canonical developer details', () => {
  assert.equal(PDEF_NAME, 'PDeF');
  assert.equal(PDEF_URL, 'https://github.com/aleksandreev2/pdef');
  assert.equal(DEVELOPER_NAME, 'dollar');
  assert.equal(DEVELOPER_URL, 'https://ranobelib.me/ru/user/726236');
  assert.equal(DEVELOPER_TEAM, 'Дом Некроманта');
  assert.equal(
    ATTRIBUTION_TEXT,
    'Документ создан с помощью PDeF. Разработчик — dollar, владелец команды «Дом Некроманта».',
  );
});

test('EPUB about page contains styled clickable PDeF authorship credit', () => {
  const book = {
    title: 'Тест',
    language: 'ru',
    team: 'Дом Некроманта',
    teamUrl: 'https://ranobelib.me/ru/team/11969--dom-nekromanta',
  };
  const html = aboutXhtml(book);
  const stylesheet = css(clampStyle({}));

  assert.ok(html.includes('class="pdef-credit"'));
  assert.ok(html.includes(`href="${PDEF_URL}"`));
  assert.ok(html.includes(`href="${DEVELOPER_URL}"`));
  assert.ok(html.includes('Документ создан с помощью'));
  assert.ok(html.includes('владелец команды «Дом Некроманта»'));
  assert.ok(stylesheet.includes('.about .pdef-credit'));
});

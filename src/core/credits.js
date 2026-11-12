'use strict';

const PDEF_NAME = 'PDeF';
const PDEF_URL = 'https://github.com/aleksandreev2/pdef';
const DEVELOPER_NAME = 'dollar';
const DEVELOPER_URL = 'https://ranobelib.me/ru/user/726236';
const DEVELOPER_TEAM = 'Дом Некроманта';
const DEVELOPER_TEAM_URL = 'https://ranobelib.me/ru/team/11969--dom-nekromanta';

const ATTRIBUTION_ID = 'pdef-credit';
const ATTRIBUTION_LINES = [
  [{ text: 'Документ создан с помощью ' }, { text: PDEF_NAME, b: true, link: PDEF_URL }, { text: '.' }],
  [{ text: 'Разработчик — ' }, { text: DEVELOPER_NAME, b: true, link: DEVELOPER_URL }],
  [{ text: 'владелец команды «' }, { text: DEVELOPER_TEAM, link: DEVELOPER_TEAM_URL }, { text: '».' }],
];
const ATTRIBUTION_TEXT = ATTRIBUTION_LINES.map(line => line.map(run => run.text).join('')).join('\n');

module.exports = {
  PDEF_NAME,
  PDEF_URL,
  DEVELOPER_NAME,
  DEVELOPER_URL,
  DEVELOPER_TEAM,
  ATTRIBUTION_ID,
  ATTRIBUTION_LINES,
  ATTRIBUTION_TEXT,
};

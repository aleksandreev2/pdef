'use strict';
// Exercises the installed executable, real preload, renderer and all six exports.
const fs = require('fs/promises');
const path = require('path');
const assert = require('assert/strict');
const {app} = require('electron');
const {findConverter} = require('../core/export/kindle');
const {resolveFonts} = require('../core/fonts');

async function waitFor(win, expression, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await win.webContents.executeJavaScript(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Таймаут проверки: ${expression}`);
}
async function runInstallationCheck(win, dir) {
  await fs.mkdir(dir, {recursive: true});
  const errors = [];
  win.webContents.on('console-message', (_event, level, message) => {if (level >= 3) errors.push(message);});
  win.webContents.on('render-process-gone', (_event, details) => errors.push(`renderer: ${details.reason}`));
  if (win.webContents.isLoading()) await new Promise((resolve, reject) => {
    win.webContents.once('did-finish-load', resolve);
    win.webContents.once('did-fail-load', (_event, code, message) => reject(new Error(`${code}: ${message}`)));
  });
  await waitFor(win, 'Boolean(window.__pdfmaker)');
  const converter = await findConverter({env: {PATH: ''}, home: path.join(dir, 'empty-home')});
  assert.ok(converter && converter.startsWith(path.join(process.resourcesPath, 'calibre')), 'Uses bundled Calibre without installed tools');
  const fonts = resolveFonts({});
  assert.equal(fonts.serif.name, 'PT Serif');
  assert.equal(fonts.sans.name, 'PT Sans');
  assert.ok(fonts.serif.regular.includes('app.asar'), 'Uses packaged fonts');
  assert.deepEqual(fonts.warnings, []);
  const input = path.join(dir, 'Глава 1.txt');
  await fs.writeFile(input, 'Глава 1. Проверка установки\n\nЗа окном светало. ' +
    'Книга открывается на новом компьютере без дополнительных установок.\n\n* * *\n\n[Сила: 10]\n[Ловкость: 20]\n\nОн отправился в путь.');
  await win.webContents.executeJavaScript(`window.__pdfmaker.addSources([${JSON.stringify(input)}])`);
  await waitFor(win, 'window.__pdfmaker.state.chapters.length === 1');
  const defaults = await win.webContents.executeJavaScript('window.api.styleDefaults()');
  assert.equal(defaults.genres.length, 11);
  await waitFor(win, "document.querySelectorAll('#layoutPreview img').length === 2", 90000);
  const manual = await win.webContents.executeJavaScript(`
    (() => {
      const field = document.getElementById('manual_titleSize');
      field.value = '30'; field.dispatchEvent(new Event('input', {bubbles: true}));
      document.getElementById('layoutUndo').click();
      const undo = field.value === '23';
      field.value = '28'; field.dispatchEvent(new Event('input', {bubbles: true}));
      document.getElementById('layoutReset').click();
      return {undo, reset: field.value === '23', controls: document.querySelectorAll('#manualLayout input').length};
    })()
  `);
  assert.deepEqual(manual, {undo: true, reset: true, controls: 11});
  await win.webContents.executeJavaScript(`
    document.getElementById('metaTitle').value = 'Проверка установки';
    window.__pdfmaker.state.outDir = ${JSON.stringify(dir)};
    for (const id of ['fmtPdf','fmtEpub','fmtFb2','fmtMobi','fmtAzw3','fmtTxt']) document.getElementById(id).checked = true;
    window.__pdfmaker.runBuild();
  `);
  await waitFor(win, 'Boolean(window.__pdfmaker.state.report)', 600000);
  const report = await win.webContents.executeJavaScript('window.__pdfmaker.state.report');
  for (const format of ['pdf', 'epub', 'fb2', 'mobi', 'azw3', 'txt']) {
    assert.ok(report[format]?.path, `${format} exported`);
    assert.ok((await fs.stat(report[format].path)).size > 100, `${format} is not empty`);
    assert.equal(report.qa[format].ok, true, JSON.stringify(report.qa[format]));
  }
  await waitFor(win, '!window.__pdfmaker.state.busy', 90000);
  await win.webContents.executeJavaScript("window.__pdfmaker.switchTab('preview')");
  await waitFor(win, "document.querySelectorAll('#previewGrid img').length > 0", 90000);
  await fs.writeFile(path.join(dir, 'preview.png'), (await win.webContents.capturePage()).toPNG());
  assert.deepEqual(errors, [], 'No renderer errors');
  await fs.writeFile(path.join(dir, 'installation-check.json'), JSON.stringify({
    ok: true, version: app.getVersion(), packaged: app.isPackaged,
    converter, fonts: {serif: fonts.serif.regular, sans: fonts.sans.regular}, report,
  }, null, 2));
}
module.exports = {runInstallationCheck};

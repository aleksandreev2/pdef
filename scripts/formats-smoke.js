'use strict';

// electron scripts/formats-smoke.js <project or app.asar> <scratch directory>
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const scratch = path.resolve(process.argv[3]);
require('node:fs').mkdirSync(path.join(scratch, 'profile'), { recursive: true });
app.setPath('userData', path.join(scratch, 'profile'));
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
const { createOutputPreferences } = require(path.join(root, 'src/main/output-preferences'));
const { DEFAULT_STYLE, LIMITS } = require(path.join(root, 'src/core/style'));
const { GENRES } = require(path.join(root, 'src/core/genres'));
const { svgTitleMark, svgSceneBreak, svgFolio } = require(path.join(root, 'src/core/signature'));
const { availableFamilies } = require(path.join(root, 'src/core/fonts'));
const file = path.join(scratch, 'preferences.json');
let prefs, win;
const errors = [];
const js = code => win.webContents.executeJavaScript(code);

async function open() {
  prefs = createOutputPreferences(file);
  win = new BrowserWindow({ show: false, width: 1280, height: 880, webPreferences: {
    preload: path.join(root, 'src/main/preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false,
  } });
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
  await win.loadFile(path.join(root, 'src/renderer/index.html'));
  const deadline = Date.now() + 15000;
  while (!await js('Boolean(window.__pdfmaker) && document.getElementById("styleGenre").options.length > 0')) {
    if (Date.now() > deadline) throw new Error('Renderer did not initialize');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

async function select(formats) {
  await js(`(() => {
    for (const [key, checked] of Object.entries(${JSON.stringify(formats)})) {
      const input = document.getElementById('fmt' + key[0].toUpperCase() + key.slice(1));
      if (input.checked !== checked) {
        input.checked = checked;
        input.dispatchEvent(new Event('change'));
      }
    }
  })()`);
  assert.deepEqual(await js('window.api.outputFormats()'), formats);
}

async function selection() {
  return js(`Object.fromEntries(['pdf','epub','fb2','mobi','azw3','txt'].map(key =>
    [key, document.getElementById('fmt' + key[0].toUpperCase() + key.slice(1)).checked]))`);
}

app.whenReady().then(async () => {
  await fs.rm(file, { force: true });
  ipcMain.handle('output:getFormats', () => prefs.getFormats());
  ipcMain.handle('output:saveFormats', (_event, formats) => prefs.setFormats(formats));
  ipcMain.handle('output:getDirectory', () => prefs.get());
  ipcMain.handle('book:getMetadata', () => prefs.getMetadata());
  ipcMain.handle('book:saveMetadata', (_event, edits) => prefs.setMetadata(edits));
  ipcMain.handle('style:defaults', () => ({ style: DEFAULT_STYLE, limits: LIMITS, families: availableFamilies(), warnings: [],
    genres: GENRES.map(g => ({ ...g, opener: svgTitleMark(g.accent, g.id), divider: svgSceneBreak(g.accent, g.id), folio: svgFolio(g.accent, g.id) })),
  }));
  const updateStatus = { currentVersion: require(path.join(root, 'package.json')).version, enabled: false, status: 'disabled', release: null, notify: false };
  ipcMain.handle('updates:status', () => updateStatus);
  ipcMain.handle('updates:check', () => updateStatus);
  await open();
  assert.deepEqual(await selection(), { pdf: true, epub: true, fb2: false, mobi: false, azw3: false, txt: false });
  const selected = { pdf: false, epub: false, fb2: true, mobi: false, azw3: true, txt: true };
  await select(selected);
  win.destroy();
  await open();
  assert.deepEqual(await selection(), selected);
  const empty = { pdf: false, epub: false, fb2: false, mobi: false, azw3: false, txt: false };
  await select(empty);
  win.destroy();
  await open();
  assert.deepEqual(await selection(), empty);
  assert.equal(await js('document.getElementById("buildBtn").disabled'), true);
  assert.deepEqual(errors, []);
  console.log('OK: actual renderer and preload restored saved formats after reopening, including an empty selection.');
  win.destroy();
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });

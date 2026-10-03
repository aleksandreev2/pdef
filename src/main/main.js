'use strict';

const path = require('path');
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');

const pipeline = require('../core/pipeline');
const { DEFAULT_STYLE, LIMITS } = require('../core/style');
const { GENRES } = require('../core/genres');
const { svgTitleMark, svgSceneBreak } = require('../core/signature');
const { availableFamilies, resolveFonts } = require('../core/fonts');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 880,
    minWidth: 1020,
    minHeight: 680,
    backgroundColor: '#15141A',
    title: 'PDFMaker Mobile',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload обращается к webUtils для путей перетащенных файлов
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  if (process.argv.includes('--dev')) mainWindow.webContents.openDevTools({ mode: 'detach' });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/** Прогресс в интерфейс. */
function sendProgress(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('progress', payload);
  }
}

/* ────────────────────────────────── IPC ────────────────────────────────── */

ipcMain.handle('dialog:pickSources', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Выберите главы, папку или архив',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Главы и архивы', extensions: ['txt', 'docx', 'zip'] },
      { name: 'Текст', extensions: ['txt'] },
      { name: 'Документы Word и Google Docs', extensions: ['docx'] },
      { name: 'Архивы', extensions: ['zip'] },
      { name: 'Все файлы', extensions: ['*'] },
    ],
  });
  return res.canceled ? [] : res.filePaths;
});

ipcMain.handle('dialog:pickFolder', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Выберите папку с главами',
    properties: ['openDirectory'],
  });
  return res.canceled ? [] : res.filePaths;
});

ipcMain.handle('dialog:pickOutDir', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Куда сохранить готовые файлы',
    properties: ['openDirectory', 'createDirectory'],
  });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('dialog:pickCover', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Выберите обложку',
    properties: ['openFile'],
    filters: [{ name: 'Изображения', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
  });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('book:analyze', async (_e, paths) => {
  return pipeline.analyze(paths, sendProgress);
});

ipcMain.handle('book:applyEdits', async (_e, edits) => pipeline.applyEdits(edits));

ipcMain.handle('book:build', async (_e, opts) => pipeline.build(opts, sendProgress));

ipcMain.handle('asset:dataUrl', async (_e, assetId) => pipeline.assetDataUrl(assetId));

ipcMain.handle('style:defaults', async () => ({
  style: DEFAULT_STYLE,
  genres: GENRES.map(g => ({ ...g, opener: svgTitleMark(g.accent, g.id), divider: svgSceneBreak(g.accent, g.id) })),
  limits: LIMITS,
  families: availableFamilies(),
  warnings: resolveFonts({}).warnings,
}));

ipcMain.handle('shell:reveal', async (_e, filePath) => {
  shell.showItemInFolder(filePath);
});

ipcMain.handle('shell:open', async (_e, filePath) => {
  const err = await shell.openPath(filePath);
  return err || null;
});

ipcMain.handle('shell:openExternal', async (_e, url) => {
  if (!/^https?:\/\//i.test(url)) return;
  await shell.openExternal(url);
});

/* ─────────────────────────────── жизненный цикл ─────────────────────────────── */

app.whenReady().then(() => {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Файл',
        submenu: [{ role: 'quit', label: 'Выход' }],
      },
      {
        label: 'Правка',
        submenu: [
          { role: 'undo', label: 'Отменить' },
          { role: 'redo', label: 'Повторить' },
          { type: 'separator' },
          { role: 'cut', label: 'Вырезать' },
          { role: 'copy', label: 'Копировать' },
          { role: 'paste', label: 'Вставить' },
          { role: 'selectAll', label: 'Выделить всё' },
        ],
      },
      {
        label: 'Вид',
        submenu: [
          { role: 'reload', label: 'Обновить' },
          { role: 'toggleDevTools', label: 'Инструменты разработчика' },
          { type: 'separator' },
          { role: 'resetZoom', label: 'Обычный масштаб' },
          { role: 'zoomIn', label: 'Увеличить' },
          { role: 'zoomOut', label: 'Уменьшить' },
        ],
      },
    ]),
  );
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

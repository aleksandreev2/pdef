'use strict';

const path = require('path');
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');

const pipeline = require('../core/pipeline');
const { DEFAULT_STYLE, LIMITS } = require('../core/style');
const { GENRES } = require('../core/genres');
const { svgTitleMark, svgSceneBreak, svgFolio } = require('../core/signature');
const { availableFamilies, resolveFonts } = require('../core/fonts');
const { createOutputPreferences } = require('./output-preferences');
const { createUpdateChecker } = require('./updates');
const { installRelease } = require('./update-install');
let installingUpdate=false,bookOperations=0;
async function bookOperation(operation) {
  if(installingUpdate) throw new Error('Дождитесь завершения обновления.');
  bookOperations++;
  try {return await operation();} finally {bookOperations--;}
}

let updateChecker;
const updates = () => updateChecker ||= createUpdateChecker({
  file: path.join(app.getPath('userData'), 'updates.json'), currentVersion: app.getVersion(),
});

// Optional release verification uses a separate profile and never touches user books/settings.
const checkIndex = process.argv.indexOf('--installation-check');
const checkDir = checkIndex >= 0 ? process.argv[checkIndex + 1] : null;
if (checkIndex >= 0) {
  if (!checkDir || !path.isAbsolute(checkDir)) throw new Error('Для проверки установки нужна абсолютная папка отчёта.');
  require('fs').mkdirSync(path.join(checkDir, 'profile'), {recursive: true});
  app.setPath('userData', path.join(checkDir, 'profile'));
}
const outputPreferences = () => createOutputPreferences(path.join(app.getPath('userData'), 'preferences.json'));

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    show: !checkDir,
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
      { name: 'Главы, книги и архивы', extensions: ['txt', 'docx', 'gdocx', 'docm', 'fb2', 'mobi', 'azw3', 'zip'] },
      { name: 'Электронные книги', extensions: ['fb2', 'mobi', 'azw3'] },
      { name: 'Текст', extensions: ['txt'] },
      { name: 'Документы Word и Google Docs', extensions: ['docx', 'gdocx', 'docm'] },
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
    title: 'Выберите постоянную папку экспорта',
    defaultPath: await outputPreferences().get() || undefined,
    properties: ['openDirectory', 'createDirectory'],
  });
  if (res.canceled) return null;
  return outputPreferences().set(res.filePaths[0]);
});

ipcMain.handle('output:getDirectory', async () => outputPreferences().get());

ipcMain.handle('updates:status', () => updates().status());
ipcMain.handle('updates:check', (_e, manual) => updates().check({ manual: manual === true }));
ipcMain.handle('updates:enabled', (_e, enabled) => updates().setEnabled(enabled === true));
ipcMain.handle('updates:dismiss', () => updates().dismiss());
ipcMain.handle('updates:open', async () => {
  const result = await updates().status();
  if (result.release) await shell.openExternal(result.release.url);
});
ipcMain.handle('updates:install', async () => {
  if(installingUpdate) throw new Error('Обновление уже выполняется.');
  if(bookOperations) throw new Error('Дождитесь завершения разбора или сборки книги.');
  if(process.platform!=='win32') throw new Error('Установка из приложения доступна для Windows.');
  installingUpdate=true;
  try {
    const result=await updates().check({manual:true});
    if(result.status!=='available') throw new Error(result.message || 'Новая версия не найдена.');
    return await installRelease({release:result.release,cacheDir:path.join(app.getPath('userData'),'update-downloads'),
      confirm:async release=>(await dialog.showMessageBox(mainWindow,{
        type:'question',title:'Обновление PDFMaker',buttons:['Отмена','Скачать и установить'],defaultId:0,cancelId:0,
        message:`Обновить PDFMaker до версии ${release.version}?`,
        detail:'После загрузки и проверки файла откроется установщик, а PDFMaker закроется. Сначала сохраните нужные книги. Настройки установленного приложения сохраняются.',
      })).response===1,
      onProgress:p=>{if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('updates:progress',p);},
      start:file=>shell.openPath(file),quit:()=>setImmediate(()=>app.quit()),
    });
  } finally {installingUpdate=false;}
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
  return bookOperation(() => pipeline.analyze(paths, sendProgress));
});

ipcMain.handle('book:applyEdits', async (_e, edits) => pipeline.applyEdits(edits));

ipcMain.handle('book:previewFrontMatter', async (_e, opts) => require('../core/pdf/front-matter-preview').previewFrontMatter(opts));

ipcMain.handle('book:build', async (_e, opts) => bookOperation(() => pipeline.build(opts, sendProgress)));

ipcMain.handle('asset:dataUrl', async (_e, assetId) => pipeline.assetDataUrl(assetId));

ipcMain.handle('style:defaults', async () => ({
  style: DEFAULT_STYLE,
  genres: GENRES.map(g => ({ ...g, opener: svgTitleMark(g.accent, g.id), divider: svgSceneBreak(g.accent, g.id), folio: svgFolio(g.accent,g.id) })),
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

  if (checkDir) {
    require('./installation-check').runInstallationCheck(mainWindow, checkDir)
      .then(() => app.exit(0))
      .catch(async error => {
        const fs = require('fs/promises');
        await fs.mkdir(checkDir, {recursive: true});
        await fs.writeFile(path.join(checkDir, 'failure.txt'), String(error.stack || error));
        app.exit(1);
      });
    return;
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

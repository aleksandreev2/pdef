'use strict';

/**
 * Проверка интерфейса целиком: окно, разбор, сборка, отчёт, предпросмотр.
 * Снимки окна сохраняются, ошибки консоли выводятся в stdout.
 *
 *   npx electron scripts/smoke.js --in <папка|zip> --out <папка для книги>
 *                                 --shots <папка для снимков> [--title "…"]
 */

const path = require('path');
const fs = require('fs/promises');
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');

const pipeline = require('../src/core/pipeline');
const { DEFAULT_STYLE, LIMITS } = require('../src/core/style');
const { availableFamilies, resolveFonts } = require('../src/core/fonts');

function parseArgs(argv) {
  const out = { in: '', out: '', shots: '', title: 'Тестовая книга' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--in') out.in = argv[++i];
    else if (argv[i] === '--out') out.out = argv[++i];
    else if (argv[i] === '--shots') out.shots = argv[++i];
    else if (argv[i] === '--title') out.title = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const problems = [];

app.disableHardwareAcceleration();

/* Те же обработчики, что и в боевом main.js. */
function registerIpc(win) {
  const send = (p) => {
    if (win && !win.isDestroyed()) win.webContents.send('progress', p);
  };
  ipcMain.handle('book:analyze', async (_e, paths) => pipeline.analyze(paths, send));
  ipcMain.handle('book:applyEdits', async (_e, edits) => pipeline.applyEdits(edits));
  ipcMain.handle('book:build', async (_e, opts) => pipeline.build(opts, send));
  ipcMain.handle('asset:dataUrl', async (_e, id) => pipeline.assetDataUrl(id));
  ipcMain.handle('style:defaults', async () => ({
    style: DEFAULT_STYLE,
    limits: LIMITS,
    families: availableFamilies(),
    warnings: resolveFonts({}).warnings,
  }));
  for (const channel of ['dialog:pickSources', 'dialog:pickFolder', 'dialog:pickCover']) {
    ipcMain.handle(channel, async () => []);
  }
  ipcMain.handle('dialog:pickOutDir', async () => args.out);
  ipcMain.handle('shell:reveal', async () => {});
  ipcMain.handle('shell:open', async () => null);
  ipcMain.handle('shell:openExternal', async () => {});
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(win, name) {
  if (!args.shots) return;
  await fs.mkdir(args.shots, { recursive: true });
  const image = await win.webContents.capturePage();
  const file = path.join(args.shots, `${name}.png`);
  await fs.writeFile(file, image.toPNG());
  console.log(`снимок: ${file}`);
}

/** Ожидание условия в окне. */
async function waitFor(win, expression, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await win.webContents.executeJavaScript(expression).catch(() => false);
    if (ok) return true;
    await sleep(400);
  }
  problems.push(`Таймаут: ${label}`);
  return false;
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1400,
    height: 940,
    show: false,
    backgroundColor: '#15141A',
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.webContents.on('console-message', (_e, level, message, line, source) => {
    const tag = ['verbose', 'info', 'warning', 'ОШИБКА'][level] || level;
    if (level >= 2) {
      const text = `[${tag}] ${message} (${String(source).split('/').pop()}:${line})`;
      console.log(text);
      if (level >= 3) problems.push(text);
    }
  });
  win.webContents.on('render-process-gone', (_e, d) => problems.push(`Процесс отрисовки упал: ${d.reason}`));

  registerIpc(win);
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));

  const ready = await waitFor(win, 'Boolean(window.__pdfmaker)', 15000, 'инициализация интерфейса');
  if (!ready) {
    console.log('ПРОБЛЕМЫ:', problems);
    app.exit(1);
    return;
  }
  await shot(win, '1-start');

  console.log('→ разбор исходников');
  await win.webContents.executeJavaScript(
    `window.__pdfmaker.addSources([${JSON.stringify(path.resolve(args.in))}])`,
  );
  await waitFor(win, 'window.__pdfmaker.state.chapters.length > 0', 300000, 'разбор исходников');
  await sleep(600);
  await shot(win, '2-chapters');

  await win.webContents.executeJavaScript(`
    document.getElementById('metaTitle').value = ${JSON.stringify(args.title)};
    document.getElementById('metaTitle').dispatchEvent(new Event('input'));
    window.__pdfmaker.switchTab('audit');
  `);
  await sleep(400);
  await shot(win, '3-audit');

  const summary = await win.webContents.executeJavaScript(`
    JSON.stringify({
      chapters: window.__pdfmaker.state.chapters.length,
      included: window.__pdfmaker.state.chapters.filter(c=>c.include).length,
      words: window.__pdfmaker.state.stats.words,
      cover: window.__pdfmaker.state.cover,
      accent: document.getElementById('styleAccent').value
    })
  `);
  console.log('состояние после разбора:', summary);

  console.log('→ сборка');
  await win.webContents.executeJavaScript(`
    window.__pdfmaker.state.outDir = ${JSON.stringify(path.resolve(args.out))};
    document.getElementById('outDirLabel').textContent = window.__pdfmaker.state.outDir;
    window.__pdfmaker.runBuild();
  `);
  await waitFor(win, 'Boolean(window.__pdfmaker.state.report)', 900000, 'сборка книги');
  await sleep(1200);
  await shot(win, '4-report');

  const report = await win.webContents.executeJavaScript(`
    JSON.stringify({
      pdf: window.__pdfmaker.state.report.pdf && {
        pages: window.__pdfmaker.state.report.pdf.pages,
        toc: window.__pdfmaker.state.report.pdf.tocPages,
        bookmarks: window.__pdfmaker.state.report.pdf.bookmarks,
        size: window.__pdfmaker.state.report.pdf.size
      },
      epub: window.__pdfmaker.state.report.epub && {
        documents: window.__pdfmaker.state.report.epub.documents,
        size: window.__pdfmaker.state.report.epub.size
      },
      pdfQa: window.__pdfmaker.state.report.qa.pdf &&
        window.__pdfmaker.state.report.qa.pdf.checks.filter(c=>!c.ok).map(c=>c.name+': '+c.detail),
      epubQa: window.__pdfmaker.state.report.qa.epub &&
        window.__pdfmaker.state.report.qa.epub.checks.filter(c=>!c.ok).map(c=>c.name+': '+c.detail)
    })
  `);
  console.log('отчёт:', report);

  console.log('→ предпросмотр');
  await win.webContents.executeJavaScript("window.__pdfmaker.switchTab('preview')");
  await waitFor(
    win,
    "document.querySelectorAll('#previewGrid img').length > 0",
    180000,
    'отрисовка предпросмотра',
  );
  await sleep(800);
  await shot(win, '5-preview');

  const logText = await win.webContents.executeJavaScript("document.getElementById('logContent').textContent");
  console.log('\n--- журнал приложения ---\n' + logText);

  if (problems.length) {
    console.log('\nПРОБЛЕМЫ:');
    for (const p of problems) console.log(' -', p);
  } else {
    console.log('\nПроблем в интерфейсе не обнаружено.');
  }

  win.destroy();
  app.exit(problems.length ? 1 : 0);
}).catch((e) => {
  console.error('ОШИБКА:', e.stack || e.message);
  app.exit(1);
});

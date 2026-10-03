'use strict';

/**
 * Сохранение страниц PDF в PNG (визуальный QA, п.8.2).
 *
 *   npx electron scripts/preview.js --pdf <файл> --out <папка> [--pages 2,3,9]
 *                                   [--width 410]
 *
 * Без --pages берутся страницы из структурной проверки: титульная,
 * оглавление, первая текстовая, плотная из середины, иллюстрация, последняя.
 */

const path = require('path');
const fs = require('fs/promises');
const { app, BrowserWindow } = require('electron');
const { pathToFileURL } = require('url');

function parseArgs(argv) {
  const out = { pdf: '', out: '', pages: null, width: 410 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--pdf') out.pdf = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--pages') out.pages = argv[++i].split(',').map((n) => Number(n.trim())).filter(Boolean);
    else if (a === '--width') out.width = Number(argv[++i]) || 410;
  }
  return out;
}

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const args = parseArgs(process.argv.slice(2));
  if (!args.pdf) {
    console.error('Укажите --pdf <файл>');
    app.exit(1);
    return;
  }
  const pdfPath = path.resolve(args.pdf);
  const outDir = path.resolve(args.out || path.dirname(pdfPath));
  await fs.mkdir(outDir, { recursive: true });

  let pages = args.pages;
  if (!pages) {
    const { checkPdf } = require('../src/core/qa/pdf');
    const probe = await checkPdf(pdfPath, {
      book: { team: 'Дом Некроманта', teamUrl: '', subtitle: 'Полное издание' },
      expected: { sections: 0, tocPages: 1, tocFirstPage: 3, chapterPages: {}, firstContentPage: 4 },
    });
    pages = (probe.visualSample || []).map((s) => s.page);
    if (!pages.length) pages = [1, 2, 3];
  }

  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: false, webSecurity: false },
  });

  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'preview.html'));

  const fileUrl = pathToFileURL(pdfPath).href;
  const results = await win.webContents.executeJavaScript(
    `window.renderPages(${JSON.stringify(fileUrl)}, ${JSON.stringify(pages)}, ${args.width})`,
  );

  for (const r of results) {
    const data = Buffer.from(r.dataUrl.split(',')[1], 'base64');
    const file = path.join(outDir, `page-${String(r.page).padStart(4, '0')}.png`);
    await fs.writeFile(file, data);
    console.log(`${file}  ${r.width}×${r.height}`);
  }

  win.destroy();
  app.exit(0);
}).catch((e) => {
  console.error('ОШИБКА:', e.message);
  app.exit(1);
});

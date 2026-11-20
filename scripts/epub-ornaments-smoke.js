'use strict';

// electron scripts/epub-ornaments-smoke.js <project or app.asar> <scratch directory>
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const scratch = path.resolve(process.argv[3]);
require('node:fs').mkdirSync(path.join(scratch, 'profile'), { recursive: true });
app.setPath('userData', path.join(scratch, 'profile'));
app.disableHardwareAcceleration();
const { buildEpub } = require(path.join(root, 'src/core/epub/build'));
const { makeBook, makeChapter } = require(path.join(root, 'src/core/model'));
const { clampStyle } = require(path.join(root, 'src/core/style'));
const { GENRES } = require(path.join(root, 'src/core/genres'));
const JSZip = require(path.join(root, 'node_modules/jszip'));

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 390, height: 780, useContentSize: true,
    webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false },
  });
  const book = makeBook();
  book.title = 'Проверка украшений';
  book.chapters = [makeChapter({ id: 'one', number: 1, title: 'Окно статуса', blocks: [
    { type: 'para', runs: [{ text: 'Тёплый свет падал на страницы раскрытой книги. За окном медленно начинался новый день.' }] },
    { type: 'sep' },
    { type: 'para', runs: [{ text: 'Украшение разделяет сцены и остаётся рядом с началом следующего абзаца.' }] },
  ] })];
  let cases = 0;
  for (const { id: genre } of GENRES) {
    const folder = path.join(scratch, genre);
    await fs.mkdir(path.join(folder, 'text'), { recursive: true });
    await fs.mkdir(path.join(folder, 'css'), { recursive: true });
    const outPath = path.join(folder, 'sample.epub');
    await buildEpub({ book, style: clampStyle({ genre }), outPath });
    const zip = await JSZip.loadAsync(await fs.readFile(outPath));
    for (const file of ['text/ch001.xhtml', 'text/title.xhtml', 'css/style.css']) {
      await fs.writeFile(path.join(folder, file), await zip.file('EPUB/' + file).async('nodebuffer'));
    }
    await win.loadFile(path.join(folder, 'text/ch001.xhtml'));
    for (const dark of [false, true]) for (const size of [16, 28, 40]) {
      const result = await win.webContents.executeJavaScript(`(() => {
        const color = ${JSON.stringify(dark ? '#ffffff' : '#141414')};
        document.body.style.color = color;
        document.body.style.fontSize = '${size}px';
        document.body.style.background = ${JSON.stringify(dark ? '#000000' : '#ffffff')};
        document.documentElement.style.background = document.body.style.background;
        const heading = document.querySelector('h1');
        const ornament = heading.querySelector('.chapter-ornament svg');
        const scene = document.querySelector('.scene svg');
        const paths = [...document.querySelectorAll('svg [stroke="currentColor"]')];
        return {
          headingOrnament: !!ornament, sceneOrnament: !!scene,
          height: ornament.getBoundingClientRect().height,
          themeColor: getComputedStyle(document.body).color,
          strokes: paths.map(p => getComputedStyle(p).stroke),
          backgrounds: [ornament, scene].map(p => getComputedStyle(p).backgroundColor),
          overflow: document.body.scrollWidth > innerWidth,
          images: document.querySelectorAll('img').length,
        };
      })()`);
      assert.ok(result.headingOrnament && result.sceneOrnament, genre);
      assert.equal(result.height, size * 2.5, genre);
      assert.ok(result.strokes.length > 0 && result.strokes.every(color => color === result.themeColor), genre);
      assert.deepEqual(result.backgrounds, ['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)'], genre);
      assert.equal(result.images, 0, genre);
      assert.equal(result.overflow, false, genre);
      if (genre === 'fantasy' && size === 28) {
        await fs.writeFile(path.join(scratch, dark ? 'dark.png' : 'light.png'), (await win.webContents.capturePage()).toPNG());
      }
      cases++;
    }
    const paging = await win.webContents.executeJavaScript(`(() => {
      const b = document.body;
      b.style.cssText = 'margin:0;padding:0;width:350px;height:700px;column-width:350px;column-gap:40px;column-fill:auto;font-size:28px';
      const h = document.querySelector('h1');
      const s = document.querySelector('.scene');
      return { headingFragments: h.getClientRects().length,
        sceneColumn: s.getClientRects()[0].x, nextColumn: s.nextElementSibling.getClientRects()[0].x };
    })()`);
    assert.equal(paging.headingFragments, 1, genre);
    assert.equal(paging.sceneColumn, paging.nextColumn, genre);
  }
  console.log(`OK: ${cases} genre/theme/font combinations; transparent vectors, inherited colors, bounded dimensions and pagination.`);
  win.destroy();
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });

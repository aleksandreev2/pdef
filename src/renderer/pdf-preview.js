/**
 * Визуальный QA (п.8.2): растеризация нескольких репрезентативных страниц
 * готового PDF в мобильной ширине. Весь набор заново не рендерится —
 * только запрошенные страницы.
 */

import * as pdfjs from '../../node_modules/pdfjs-dist/build/pdf.min.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  '../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).href;

let cached = { url: null, doc: null };

async function openDoc(fileUrl) {
  if (cached.url === fileUrl && cached.doc) return cached.doc;
  if (cached.doc) {
    try {
      await cached.doc.destroy();
    } catch {
      /* уже закрыт */
    }
  }
  const doc = await pdfjs.getDocument({ url: fileUrl, useSystemFonts: false }).promise;
  cached = { url: fileUrl, doc };
  return doc;
}

/**
 * @param {string} filePath путь к PDF
 * @param {Array<{page:number, why:string}>} sample
 * @param {number} cssWidth мобильная ширина отрисовки
 * @returns {Promise<Array<{page:number, why:string, dataUrl:string}>>}
 */
export async function renderSample(filePath, sample, cssWidth = 410) {
  const fileUrl = `file:///${filePath.replace(/\\/g, '/').replace(/^\/+/, '')}`;
  const doc = await openDoc(fileUrl);
  const out = [];

  for (const item of sample) {
    if (item.page < 1 || item.page > doc.numPages) continue;
    const page = await doc.getPage(item.page);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: (cssWidth / base.width) * 2 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    out.push({ page: item.page, why: item.why, dataUrl: canvas.toDataURL('image/png') });
    page.cleanup();
  }

  return out;
}

export function forgetDocument() {
  if (cached.doc) {
    cached.doc.destroy().catch(() => {});
  }
  cached = { url: null, doc: null };
}

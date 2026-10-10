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

export async function renderFrontMatter(data, style) {
  const doc = await pdfjs.getDocument({data:new Uint8Array(data),useSystemFonts:false}).promise;
  const pages=[];
  const warnings=[];
  try {
    for(const [pageNo,label] of [[2,'Титульная страница'],[4,'О переводе']]) {
      const page=await doc.getPage(pageNo);
      const base=page.getViewport({scale:1});
      const viewport=page.getViewport({scale:600/base.width});
      const canvas=document.createElement('canvas');
      canvas.width=Math.ceil(viewport.width); canvas.height=Math.ceil(viewport.height);
      await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
      pages.push({label,dataUrl:canvas.toDataURL('image/png')});
      const {items}=await page.getTextContent();
      const mm=72/25.4;
      const text=items.filter(i=>i.str.trim() && !(pageNo===4 && i.str==='4' && i.transform[5]<style.marginBottomMm*mm));
      for(const item of text) {
        const x=item.transform[4],y=item.transform[5];
        if(x<style.marginLeftMm*mm-.5 || x+item.width>base.width-style.marginRightMm*mm+.5 ||
          y<style.marginBottomMm*mm || y+item.height>base.height-style.marginTopMm*mm+.5) {
          warnings.push(`${label}: текст выходит за поля — «${item.str}»`);
        }
      }
      for(let a=0;a<text.length;a++) for(let b=a+1;b<text.length;b++) {
        const p=text[a],q=text[b];
        const dx=Math.min(p.transform[4]+p.width,q.transform[4]+q.width)-Math.max(p.transform[4],q.transform[4]);
        const dy=Math.min(p.transform[5]+p.height,q.transform[5]+q.height)-Math.max(p.transform[5],q.transform[5]);
        if(dx>1 && dy>2) warnings.push(`${label}: текстовые блоки перекрываются. Уменьшите кегль или измените отступы.`);
      }
      page.cleanup();
    }
    return {pages,warnings:[...new Set(warnings)]};
  } finally { await doc.destroy(); }
}

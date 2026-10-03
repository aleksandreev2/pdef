'use strict';
const { parseDocument } = require('htmlparser2');
const { makeRun, runsText } = require('../model');
const SKIP = new Set(['head','script','style','iframe','object','template','form']);
const BLOCK = new Set(['html','body','main','header','footer','nav','center','p','div','section','article','blockquote','pre','h1','h2','h3','h4','h5','h6','li','ul','ol','dl','dt','dd','table','tr','hr','img']);
function parseHtml(html, image, warnings = []) {
  const root = parseDocument(html, { decodeEntities: true });
  const out = [];
  function walk(nodes, fmt = {}, context = {}) {
    let runs = [];
    const flush = () => { if (runsText(runs).trim()) out.push({ runs, ...context }); runs = []; };
    for (const node of nodes || []) {
      if (node.type === 'text') { runs.push(makeRun(node.data.replace(/\s+/g,' '),fmt)); continue; }
      const tag = (node.name || '').toLowerCase();
      if (!tag || SKIP.has(tag)) continue;
      const attrs = node.attribs || {};
      const style = attrs.style || '';
      const next = { ...fmt };
      if (['b','strong'].includes(tag) || /font-weight\s*:\s*(?:bold|[7-9]00)/i.test(style)) next.b = true;
      if (['i','em'].includes(tag) || /font-style\s*:\s*italic/i.test(style)) next.i = true;
      if (tag === 'u' || /text-decoration\s*:[^;]*underline/i.test(style)) next.u = true;
      if (tag === 'a' && /^(?:https?:|mailto:)/i.test(attrs.href || '')) next.link = attrs.href;
      if (tag === 'br') { runs.push(makeRun('\n',next)); continue; }
      if (!BLOCK.has(tag)) {
        // Inline descendants stay in the same paragraph and retain emphasis.
        const start = out.length;
        const tail = runs; runs = [];
        walk(node.children,next,{});
        const pieces = out.splice(start);
        runs = tail;
        for (const p of pieces) {
          if (p.runs) runs.push(...p.runs);
          else { flush(); out.push(p); }
        }
        continue;
      }
      flush();
      if (tag === 'img') {
        const assetId = image ? image(attrs.src || '') : null;
        if (assetId) out.push({ image: { assetId, alt: attrs.alt || '' } });
        else warnings.push('Иллюстрация не импортирована: отсутствует встроенный ресурс');
      } else if (tag === 'hr') out.push({ runs: [makeRun('* * *')] });
      else if (tag === 'table') {
        const rows = [];
        const visit = n => { if (n.name === 'tr') rows.push(n); else for (const child of n.children || []) visit(child); };
        visit(node);
        const text = n => n.type === 'text' ? n.data : SKIP.has(n.name) ? '' : (n.children || []).map(text).join('');
        const lines = rows.map(row => [makeRun((row.children || []).filter(c=>['td','th'].includes(c.name)).map(text).join('  ·  '))]);
        if (lines.length) out.push({ table: true, lines });
      } else {
        const align = attrs.align || style.match(/text-align\s*:\s*(left|right|center|justify)/i)?.[1];
        const ctx = { ...context, ...(align ? { align } : {}) };
        if (/^h[1-6]$/.test(tag)) { ctx.style = 'Heading' + tag[1]; next.b = true; }
        if (tag === 'ul' || tag === 'ol') ctx.list = { ordered: tag === 'ol', level: 0 };
        walk(node.children,next,ctx);
      }
    }
    flush();
  }
  walk(root.children);
  return out;
}
function splitHtmlSections(rawParas, fallbackTitle = '') {
  const sections = []; let raw = [];
  const flush = () => {
    if (raw.length) {
      const first = raw.find(p=>p.runs);
      sections.push({ title: /^Heading[12]$/.test(first?.style || '') ? runsText(first.runs).trim() : fallbackTitle, rawParas: raw });
    }
    raw = [];
  };
  for (const p of rawParas) {
    if (/^Heading[12]$/.test(p.style || '') && raw.some(r=>r.image || r.table || (r.runs && !/^Heading[12]$/.test(r.style || '')))) flush();
    raw.push(p);
  }
  flush(); return sections;
}
module.exports = { parseHtml, splitHtmlSections };

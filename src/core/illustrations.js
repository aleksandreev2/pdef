'use strict';

const crypto = require('crypto');
const { blockText } = require('./model');
const { computeStats } = require('./stats');

const PRESETS = {
  balanced: { maxEdge: 1600, quality: 82 },
  strong: { maxEdge: 1000, quality: 65 },
};

function illustrationOptions(input = {}) {
  const version = input.version ?? 'with';
  const compression = input.compression ?? 'off';
  if (!['with', 'without', 'both'].includes(version)) throw new Error('Неизвестная версия иллюстраций: ' + version);
  if (!['off', ...Object.keys(PRESETS)].includes(compression)) throw new Error('Неизвестный режим сжатия иллюстраций: ' + compression);
  return { version, compression, keepCover: input.keepCover !== false };
}

async function compressAsset(asset, preset) {
  // Keep vector graphics and animation intact. Decode only local buffers.
  if (!['jpg', 'jpeg', 'png', 'webp', 'bmp'].includes(String(asset.ext).toLowerCase())) return { ...asset };
  const { createCanvas, loadImage } = require('@napi-rs/canvas');
  const image = await loadImage(asset.data);
  if (!image.width || !image.height || image.width * image.height > 40000000) {
    throw new Error('изображение слишком большое для обработки');
  }
  const scale = Math.min(1, preset.maxEdge / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height).data;
  let transparent = false;
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] < 255) { transparent = true; break; }
  }
  const data = transparent ? await canvas.encode('png') : await canvas.encode('jpeg', preset.quality);
  if (data.length >= asset.data.length) return { ...asset };
  return {
    ...asset, data, ext: transparent ? 'png' : 'jpg', mime: transparent ? 'image/png' : 'image/jpeg',
    pxW: width, pxH: height, hash: crypto.createHash('sha256').update(data).digest('hex'),
  };
}

/** Prepare an export copy; imports and subsequent builds keep their originals. */
async function prepareIllustrations(source, options, onProgress = () => {}) {
  const without = options.version === 'without';
  const book = {
    ...source,
    cover: source.cover && (!without || options.keepCover) ? { ...source.cover } : null,
    chapters: source.chapters.map(ch => {
      const blocks = without ? ch.blocks.filter(b => b.type !== 'image') : [...ch.blocks];
      const removedImages = without && blocks.length !== ch.blocks.length;
      const hasContent = blocks.some(b => b.type !== 'sep' && blockText(b).trim());
      return { ...ch, blocks, include: ch.include && !(removedImages && !hasContent) };
    }),
    assets: new Map(),
  };
  const used = new Set();
  for (const ch of book.chapters.filter(c => c.include)) {
    for (const b of ch.blocks) if (b.type === 'image' && b.assetId) used.add(b.assetId);
  }
  if (book.cover) used.add(book.cover.assetId);
  const report = { ...options, originalBytes: 0, outputBytes: 0, savedBytes: 0, compressed: 0, warnings: [] };
  const cache = new Map();
  let done = 0;
  for (const id of used) {
    const asset = source.assets.get(id);
    if (!asset) continue;
    report.originalBytes += asset.data.length;
    let output = { ...asset };
    if (options.compression !== 'off') {
      onProgress({ phase: 'images', label: 'Сжатие иллюстраций', done: done++, total: used.size });
      try {
        const key = crypto.createHash('sha256').update(asset.data).digest('hex') + ':' + asset.ext;
        if (!cache.has(key)) cache.set(key, await compressAsset(asset, PRESETS[options.compression]));
        output = { ...cache.get(key), id: asset.id };
      } catch (e) {
        report.warnings.push(`Иллюстрация ${id}: сжатие пропущено (${e.message}); сохранён оригинал`);
      }
    }
    book.assets.set(id, output);
    report.outputBytes += output.data.length;
    if (output.data.length < asset.data.length) report.compressed += 1;
  }
  report.savedBytes = report.originalBytes - report.outputBytes;
  book.stats = computeStats(book.chapters);
  return { book, report };
}

module.exports = { illustrationOptions, prepareIllustrations };

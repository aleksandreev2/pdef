/**
 * Подбор ОДНОГО спокойного акцентного цвета из обложки (п.3 спецификации).
 * Кричащие и выцветшие оттенки отбрасываются: нужен цвет, который не будет
 * спорить с текстом в тонких линиях и номерах глав.
 */

const SAT_RANGE = [0.18, 0.72];
const LIGHT_RANGE = [0.26, 0.6];

function rgbToHsl(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
    else if (max === gn) h = ((bn - rn) / d + 2) / 6;
    else h = ((rn - gn) / d + 4) / 6;
  }
  return [h, s, l];
}

function hslToHex(h, s, l) {
  const hue = (p, q, t) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  let r;
  let g;
  let b;
  if (s === 0) {
    r = l;
    g = l;
    b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue(p, q, h + 1 / 3);
    g = hue(p, q, h);
    b = hue(p, q, h - 1 / 3);
  }
  const to = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
}

/**
 * @param {string} dataUrl обложка
 * @returns {Promise<string|null>} HEX-цвет
 */
export async function accentFromImage(dataUrl) {
  const img = await loadImage(dataUrl);
  const side = 96;
  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, side, side);
  const { data } = ctx.getImageData(0, 0, side, side);

  // Гистограмма по 24 тонам × 3 уровням насыщенности.
  const buckets = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 200) continue;
    const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    if (s < SAT_RANGE[0] || s > SAT_RANGE[1]) continue;
    if (l < LIGHT_RANGE[0] || l > LIGHT_RANGE[1]) continue;
    const key = `${Math.round(h * 24)}|${Math.round(s * 3)}`;
    const cur = buckets.get(key) || { n: 0, h: 0, s: 0, l: 0 };
    cur.n += 1;
    cur.h += h;
    cur.s += s;
    cur.l += l;
    buckets.set(key, cur);
  }

  if (!buckets.size) return null;

  const best = [...buckets.values()].sort((a, b) => b.n - a.n)[0];
  const h = best.h / best.n;
  // Приглушаем результат: акцент работает в тонких линиях и мелком кегле.
  const s = Math.min(0.52, Math.max(0.22, best.s / best.n));
  const l = Math.min(0.52, Math.max(0.34, best.l / best.n));
  return hslToHex(h, s, l);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Изображение не загружается'));
    img.src = src;
  });
}

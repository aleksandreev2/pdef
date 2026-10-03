'use strict';
const { genreProfile } = require('./genres');

// Одни векторные контуры для PDF, EPUB и образца в интерфейсе.
const P = (d, fill = false, sx = 1) => ({ d, fill, sx });
const pair = d => [P(d), P(d, false, -1)];
const circle = (x, r) => P(`M ${x-r} 0 C ${x-r} ${-r*1.333} ${x+r} ${-r*1.333} ${x+r} 0 C ${x+r} ${r*1.333} ${x-r} ${r*1.333} ${x-r} 0 Z`);
const star = r => P(`M 0 ${-r} L 3 -3 L ${r} 0 L 3 3 L 0 ${r} L -3 3 L ${-r} 0 L -3 -3 Z`);
const vine = () => [
  ...pair('M 18 0 C 38 9 55 -12 77 -2 C 92 6 107 -5 114 -2'),
  ...pair('M 36 3 C 36 -6 45 -10 49 -9 C 45 -3 41 1 36 3 M 57 -2 C 58 6 66 10 71 8 C 69 2 63 -1 57 -2 M 81 -1 C 82 -9 91 -13 95 -11 C 91 -5 87 -2 81 -1'),
  ...pair('M 27 2 C 28 12 37 14 40 10 C 35 9 31 5 27 2'),
];

function ornamentPaths(genre, header = false) {
  const id = genreProfile(genre).id;
  let paths;
  switch (id) {
    case 'fantasy':
      paths = [star(16), star(8), ...vine(), ...pair('M 20 0 L 27 0 M 103 0 L 116 0')]; break;
    case 'dark-fantasy':
      paths = [P('M 0 -19 L 12 0 L 0 19 L -12 0 Z M 0 -11 L 6 0 L 0 11 L -6 0 Z'),
        ...pair('M 13 0 L 28 -7 L 37 0 L 28 7 Z M 37 0 L 49 -5 L 59 0 L 49 5 Z M 60 0 L 111 0 M 73 -4 L 79 0 L 73 4'),
        ...pair('M 14 0 C 28 -12 43 -15 56 -7 C 70 3 89 -10 105 -3')]; break;
    case 'horror':
      paths = [P('M 7 -17 C -16 -18 -22 18 4 18 C -9 9 -10 -6 7 -17 Z'),
        ...pair('M 22 3 C 43 -4 57 5 82 0 L 112 -5 M 39 0 L 47 -10 L 59 -12 M 47 -10 L 43 -15 M 65 2 L 74 12 L 87 16 M 74 12 L 75 18 M 86 -1 L 98 -12 M 96 -9 L 107 -8')]; break;
    case 'sci-fi':
      paths = [circle(0, 12), circle(0, 8),
        P('M -24 -5 C -13 -19 17 -9 24 5 C 13 19 -17 9 -24 -5 Z'),
        ...pair('M 29 0 L 45 0 M 54 0 L 88 0 M 95 0 L 113 0'), circle(49, 3), circle(-49, 3)]; break;
    case 'litrpg':
      paths = [P('M 0 -20 L 13 -6 L 8 11 L 0 20 L -8 11 L -13 -6 Z M 0 -20 L 4 -5 L 0 20 L -4 -5 Z M -13 -6 L -4 -5 L 4 -5 L 13 -6'),
        ...pair('M 18 3 L 31 -8 L 52 -8 L 65 2 L 98 2 L 111 -5 M 23 9 L 37 -2 L 51 -2 L 66 8 L 91 8 M 78 -4 L 95 -4')]; break;
    case 'romance':
      paths = [circle(0, 3),
        P('M 0 -3 C -12 -20 12 -20 0 -3 M 3 0 C 20 -12 20 12 3 0 M 0 3 C 12 20 -12 20 0 3 M -3 0 C -20 12 -20 -12 -3 0'),
        ...vine(), ...pair('M 19 1 C 32 -18 48 -15 46 -4 C 44 5 34 3 37 -3 M 66 1 C 78 20 97 16 94 5 C 92 -2 86 1 87 6')]; break;
    case 'historical':
      paths = [P('M 0 9 C -4 -4 -19 -12 -22 -2 C -25 8 -14 12 -9 3 M 0 9 C 4 -4 19 -12 22 -2 C 25 8 14 12 9 3 M 0 8 C -7 -8 -10 -21 0 -22 C 10 -21 7 -8 0 8 M -13 13 L 13 13'),
        ...pair('M 25 1 C 44 -15 64 -17 70 -4 C 78 12 58 18 52 8 C 47 0 57 -5 62 1 M 25 6 C 41 0 41 12 46 15 M 72 2 C 83 9 97 5 113 0'),
        ...pair('M 39 -8 C 42 -16 52 -19 59 -16 C 51 -13 46 -8 39 -8')]; break;
    case 'thriller':
      paths = [star(20), P('M 0 -8 L 4 0 L 0 8 L -4 0 Z', true),
        ...pair('M 20 0 L 43 0 M 52 0 L 109 0 M 34 -4 L 85 -4 M 64 4 L 115 4')]; break;
    case 'cultivation':
      paths = [circle(0, 13), circle(0, 9),
        ...pair('M 19 6 C 24 14 43 13 48 4 C 62 8 76 -3 70 -12 C 65 -20 54 -18 50 -12 C 39 -18 25 -9 30 -1 C 34 6 46 5 46 -2 C 47 -8 39 -10 36 -5 M 22 8 C 37 21 61 12 64 5 M 53 -9 C 62 -12 66 -4 58 0 M 70 2 C 84 15 105 -4 116 -1 M 77 7 C 88 14 103 2 112 4')]; break;
    case 'regression':
      paths = [circle(-10, 15), circle(10, 15), circle(0, 20), star(9),
        ...pair('M 29 0 L 45 0 M 55 0 L 104 0'), circle(50, 4), circle(-50, 4),
        ...pair('M 29 -7 C 48 -21 65 -18 73 -6 M 29 7 C 43 18 56 20 66 10')]; break;
  }
  if (header) {
    if (id === 'dark-fantasy') paths.push(...pair('M 2 -24 C 27 -12 58 -26 83 -16 C 96 -11 102 -3 113 4 M 91 -22 L 95 -8 L 99 -22 M 106 -20 L 110 -5 L 114 -20'));
    else if (id === 'romance' || id === 'fantasy') paths.push(...pair('M 19 -20 C 41 -30 82 -21 110 -11 M 57 -22 C 60 -28 67 -30 72 -27 M 88 -17 C 91 -23 99 -24 104 -21'));
    else if (id === 'historical') paths.push(...pair('M 25 -23 C 51 -31 89 -29 114 -21 M 40 -25 L 44 -19 M 70 -27 L 74 -22 M 99 -25 L 103 -20'));
    else if (id === 'sci-fi' || id === 'regression') paths.push(P('M -89 -16 C -40 -35 43 -35 91 -16 M -103 18 C -51 30 49 30 103 18'));
    else if (id === 'litrpg') paths.push(...pair('M 29 -22 L 55 -22 L 68 -14 L 94 -14 L 112 -24 M 80 20 L 102 20 L 113 10'));
    else if (id === 'horror') paths.push(...pair('M 70 -19 L 84 -26 L 103 -24 M 84 -26 L 87 -31 M 103 -24 L 113 -28'));
    else if (id === 'cultivation') paths.push(...pair('M 37 -23 C 51 -33 70 -25 83 -26 C 99 -27 111 -18 109 -13'));
    else paths.push(...pair('M 28 -23 L 109 -23 L 109 -15 M 73 20 L 111 20'));
  }
  return paths;
}

function drawOrnament(doc, cx, y, width, accent, genre, header = false) {
  const height = header ? 64 : 48, scale = width / 240;
  doc.save().translate(cx, y + height * scale / 2).scale(scale);
  for (const shape of ornamentPaths(genre, header)) {
    doc.save().scale(shape.sx, 1).lineWidth(0.8).strokeColor(accent).fillColor(accent);
    doc.path(shape.d);
    if (shape.fill) doc.fill(); else doc.stroke();
    doc.restore();
  }
  doc.restore();
  return height * scale;
}
function svgOrnament(accent, genre, header = false) {
  const color = /^#[0-9a-f]{6}$/i.test(accent) ? accent : genreProfile(genre).accent;
  const h = header ? 64 : 48;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 ${h}" width="240" height="${h}" role="presentation"><g transform="translate(120 ${h/2})">${ornamentPaths(genre, header).map(p => `<path transform="scale(${p.sx} 1)" d="${p.d}" fill="${p.fill ? color : 'none'}" stroke="${color}" stroke-width="0.8" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}</g></svg>`;
}
function drawTitleMark(doc, cx, y, w, accent, genre) { return drawOrnament(doc, cx, y, Math.min(w, 210), accent, genre, true); }
function drawOpenerMark(doc, cx, y, w, accent, genre) { return drawOrnament(doc, cx, y, w, accent, genre, true); }
function drawSceneBreak(doc, cx, y, accent, genre, width = 150) { return drawOrnament(doc, cx, y, width, accent, genre); }
function svgTitleMark(accent, genre) { return svgOrnament(accent, genre, true); }
function svgSceneBreak(accent, genre) { return svgOrnament(accent, genre); }

function drawPageFrame(doc, geom, style) {
  if (!style.signature) return;
  const inset = 12, right = geom.pageW - inset, bottom = geom.pageH - inset;
  doc.save().strokeColor(style.accent).lineWidth(0.35).strokeOpacity(0.4);
  doc.path(`M ${inset+18} ${inset} L ${inset} ${inset} L ${inset} ${inset+30} M ${right-18} ${inset} L ${right} ${inset} L ${right} ${inset+30} M ${inset} ${bottom-30} L ${inset} ${bottom} L ${inset+18} ${bottom} M ${right} ${bottom-30} L ${right} ${bottom} L ${right-18} ${bottom}`).stroke();
  doc.path(`M ${inset} ${inset+36} L ${inset} ${bottom-36} M ${right} ${inset+36} L ${right} ${bottom-36}`).stroke();
  doc.restore();
  for (const [x,y] of [[inset+5,inset+6],[right-5,inset+6],[inset+5,bottom-6],[right-5,bottom-6]]) drawOrnament(doc, x, y-3, 17, style.accent, style.genre);
}
module.exports = { drawTitleMark, drawOpenerMark, drawSceneBreak, svgTitleMark, svgSceneBreak, drawPageFrame };

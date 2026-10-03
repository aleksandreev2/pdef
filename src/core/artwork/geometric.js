'use strict';

// All artwork is self-contained vector geometry. Coordinates follow the layout
// contract in docs/appearance-reference.md; the frame never supplies an opener.
const GOLD = '#b38a45';
const INK = '#30313a';
const DEFAULTS = {
  'dark-fantasy': '#6c2529', 'sci-fi': '#225d79', litrpg: '#326b45',
  thriller: '#a0262d', regression: '#62548b',
};
const path = (d, color, width = 2, extra = '') =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" ${extra}/>`;
const line = (x1, y1, x2, y2, c, w = 2, extra = '') =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="${w}" ${extra}/>`;
const circle = (x, y, r, c, w = 2, fill = 'none', extra = '') =>
  `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="${c}" stroke-width="${w}" ${extra}/>`;
const ellipse = (x, y, rx, ry, c, w = 2, extra = '') =>
  `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="none" stroke="${c}" stroke-width="${w}" ${extra}/>`;
const poly = (points, c, w = 2, fill = 'none', extra = '') =>
  `<polygon points="${points}" fill="${fill}" stroke="${c}" stroke-width="${w}" ${extra}/>`;
const group = (geometry, transform = '', extra = '') =>
  `<g${transform ? ` transform="${transform}"` : ''} ${extra}>${geometry}</g>`;
const mirror = geometry => geometry + group(geometry, 'translate(1000 0) scale(-1 1)');
const diamond = (x, y, rx, ry, c, w = 2, fill = 'none') =>
  poly(`${x},${y - ry} ${x + rx},${y} ${x},${y + ry} ${x - rx},${y}`, c, w, fill);
const dots = (points, c, r = 3) => points.map(([x, y]) => circle(x, y, r, c, 1, c)).join('');

function gothicGem(x, y, size, c, fine = false) {
  return group(
    diamond(0, 0, 22, 57, c, fine ? 2 : 2.5) +
    poly('0,-50 12,0 0,42 -12,0', c, 1.2, c, 'fill-opacity=".75"') +
    path('M0 -57 L-12 0 L0 57 L12 0 Z M-22 0 L22 0 M0 -57 L0 -75 M0 57 L0 72', c, 1.3),
    `translate(${x} ${y}) scale(${size})`);
}

function cathedral(c) {
  let half = path('M40 272 L40 196 C40 98 140 48 303 41 C428 36 478 25 500 3', c, 4);
  half += path('M50 275 L50 201 C50 109 159 59 313 53 C427 50 480 36 500 12', c, 1.4);
  half += path('M67 246 C81 207 91 159 135 123 C201 70 341 89 413 69 C460 56 484 43 500 22', c, 2.6);
  half += path('M56 227 C69 172 91 145 137 135 M137 135 C152 91 183 87 216 119 M216 119 C238 70 278 72 309 109 M309 109 C337 65 377 60 405 92 M405 92 C429 57 452 45 474 53', c, 2.1);
  half += path('M78 210 C71 164 94 146 116 166 M97 181 C108 146 132 145 150 168 M137 135 C136 148 141 160 146 173 M216 119 L216 158 M309 109 L309 151 M405 92 L405 129', c, 1.1);
  half += path('M117 166 Q140 185 155 205 M163 120 Q178 102 184 121 M248 101 Q268 89 273 110 M345 81 Q365 69 371 91', c, 1.3);
  for (const [x,y] of [[137,147],[216,139],[309,130],[405,111]]) {
    half += diamond(x,y,4,9,c,1.1,c) + line(x,y+9,x,y+33,c,1.1);
    half += circle(x,y-12,2,c,.8,c);
  }
  // Slender flying buttress and three stepped finials at each side.
  half += path('M36 267 L36 219 L17 183 L7 183 L27 176 L35 161 L40 23 L45 161 L54 176 L72 183 L58 185 L44 218 L44 267 M27 176 L40 201 L54 176 M40 23 L31 68 L40 80 L49 68 Z M35 91 L45 91 M35 98 L45 98 M33 117 L47 117 M32 121 L48 121',c,2.1);
  half += path('M88 133 L83 99 L89 47 L94 99 L91 125 M83 99 L94 99 M84 105 L93 105 M91 113 L105 141 M40 161 L68 175 L78 211',c,1.4);
  return mirror(half) + gothicGem(500,142,1.18,c) +
    path('M500 8 L454 112 L474 144 M500 8 L546 112 L526 144 M500 29 L465 110 M500 29 L535 110',c,1.7);
}

function gothicDivider(c) {
  let half = line(78,80,453,80,c,1.8) + line(91,84,433,84,c,.65);
  for (const [x,r] of [[185,10],[224,16],[270,21],[320,25],[373,28],[425,20]]) {
    half += diamond(x,80,r,r*.65,c,1.8);
  }
  half += path('M384 80 L450 56 L478 80 L450 104 Z M405 80 L453 66 L469 80 L453 94 Z',c,1.5);
  return mirror(half) + gothicGem(500,80,.9,c);
}

function gothicCorner(c) {
  return path('M6 94 L6 14 Q13 14 14 6 L94 6 M11 88 L11 24 Q24 24 24 11 L88 11',c,.85) +
    path('M8 52 C9 28 26 31 30 10 M8 75 C18 66 37 67 44 48 C44 69 22 88 9 91 M14 88 C25 70 38 65 52 65 M14 88 C17 76 13 65 8 59 M17 16 C37 17 34 39 59 9 M22 21 C30 29 40 32 51 25',c,.9) +
    poly('12,81 25,56 27,73 46,75',c,.8) + diamond(14,14,3,7,c,.7,c);
}

function planet(x,y,r,c,w=2) {
  return circle(x,y,r,c,w) + circle(x,y,r*.88,c,w*.5) +
    circle(x,y,r*.81,c,w*.35,c,'fill-opacity=".88"') +
    path(`M${x-r*.53} ${y-r*.62} C${x-r*.56} ${y+r*.03} ${x+r*.03} ${y+r*.56} ${x+r*.63} ${y+r*.56} C${x+r*.89} ${y+r*.12} ${x+r*.6} ${y-r*.44} ${x+r*.12} ${y-r*.74} C${x-r*.12} ${y-r*.84} ${x-r*.34} ${y-r*.78} ${x-r*.53} ${y-r*.62} Z`,'#fffcf5',w*.65) +
    path(`M${x-r*.64} ${y-r*.27} Q${x-r*.23} ${y+r*.45} ${x+r*.57} ${y+r*.54} M${x-r*.47} ${y-r*.55} Q${x-r*.03} ${y+r*.05} ${x+r*.71} ${y+r*.23} M${x-r*.57} ${y+r*.16} Q${x-r*.03} ${y+r*.68} ${x+r*.35} ${y+r*.71}`,'#fffcf5',w*.7) +
    path(`M${x-r*.44} ${y-r*.62} Q${x-r*.68} ${y-r*.04} ${x-r*.28} ${y+r*.47} Q${x-r*.05} ${y+r*.65} ${x+r*.22} ${y+r*.67}`,'#fffcf5',w*.8);
}

function orbits(c) {
  let art = ellipse(500,135,365,64,c,2.7,'transform="rotate(-17 500 135)"');
  art += ellipse(500,134,270,92,c,1.1,'stroke-dasharray="2 8" transform="rotate(16 500 134)"');
  art += ellipse(500,130,156,103,c,1.4,'stroke-dasharray="3 7"') + ellipse(500,133,337,109,c,1,'stroke-dasharray="1 8"');
  art += path('M364 142 C350 77 409 20 502 20 C609 20 654 74 642 143 M500 0 L500 268 M488 22 L512 22 M488 251 L512 251',c,1.5);
  art += planet(500,125,52,c,2.7) + circle(500,125,60,c,.7);
  art += dots([[302,41],[302,225],[502,22],[500,245],[688,40],[749,128],[823,247],[421,248]],c,5);
  art += circle(339,105,3,c,1) + circle(592,226,3,c,1) + circle(690,87,3,c,1,c);
  art += path('M472 31 L475 53 L463 73 M568 39 L571 49 L581 56 M555 211 L552 229 L541 241',c,1.2);
  return art;
}

function orbitDivider(c) {
  return line(80,80,410,80,c,1.9) + line(590,80,920,80,c,1.9) +
    circle(500,80,62,c,1.7) + circle(500,80,69,c,.8,'none','stroke-dasharray="1 12"') +
    planet(500,80,39,c,2.2) + line(500,5,500,24,c,1) + line(500,136,500,155,c,1) +
    [[194,9],[369,7],[631,7],[811,12]].map(([x,r])=>circle(x,80,r,c,2,r===12?c:'none')).join('') +
    dots([[94,80],[129,80],[866,80],[907,80]],c,2.5);
}

function circuitCorner(c) {
  return path('M5 96 L5 23 L23 5 L95 5 M10 91 L10 28 L28 10 L88 10 M17 70 L17 33 L34 17 L61 17 M17 78 L26 87 L80 87 M36 12 L29 23 L29 36 M12 47 L22 38 L22 30 M63 10 L71 14 L90 14',c,.8) +
    circle(17,71,1.7,c,.7,c)+circle(29,36,1.6,c,.7,c)+circle(80,87,1.7,c,.7)+
    path('M6 79 L11 83 M44 5 L50 10 M80 5 L88 10',c,.6);
}

function crystal(x,y,s,c,fine=false) {
  return group(poly('0,-65 31,0 0,65 -31,0',c,fine?1.8:2.8) +
    poly('0,-65 -31,0 -14,-5 0,47',c,.6,c,'fill-opacity=".16"') +
    poly('14,-5 31,0 0,65 0,47',c,.6,c,'fill-opacity=".48"') +
    poly('0,-65 14,-5 0,47 -14,-5',c,1.3) +
    poly('0,-55 12,-5 0,34 -3,-5',c,1,c,'fill-opacity=".75"') +
    path('M-31 0 L-14 -5 L0 65 L14 -5 L31 0 M0 -65 L0 -6 M-14 -5 L0 9 L14 -5 M0 9 L0 65',c,1.3),`translate(${x} ${y}) scale(${s})`);
}

function crystalArchitecture(c) {
  let half = path('M32 242 L32 75 L68 30 L392 30 L415 7 M47 227 L47 87 L81 43 L368 43 L401 11 M65 50 L142 50 L167 69 L288 69 L308 50 L351 50',c,2.4);
  half += path('M90 60 L57 93 L99 101 L142 72 L217 124 L311 124 L352 78 L406 78 L442 117 M112 65 L158 65 L228 111 L302 111 L346 65 L389 65 L424 96',c,2.4);
  half += path('M99 101 L101 87 L142 61 M168 69 L226 98 L281 98 L319 59 M227 124 L241 136 L309 136 L366 91 L409 91 L426 109 M309 124 L336 137 L353 156 L379 156 L376 146 L358 132 L376 114',c,1.2);
  half += path('M220 31 L225 42 L238 42 L242 31 M355 68 L366 56 M379 94 L398 109 M337 138 L330 145 L341 156',c,1.1);
  half += diamond(55,66,11,31,c,1.7) + diamond(55,66,5,17,c,.9,c) + dots([[226,42],[319,59],[379,156]],c,2);
  return mirror(half)+crystal(500,132,1.62,c)+path('M500 4 L452 126 L500 271 L548 126 Z',c,1.1);
}

function crystalDivider(c) {
  let half = path('M87 58 L347 58 L397 93 L457 93 L489 131 M87 58 L135 90 L177 67 L309 67 L358 102 L421 102 L474 135 M177 67 L212 55 L278 55 L288 64 M249 68 L283 80 L336 80 L370 109 L424 109 M306 58 L335 48 L365 76 L386 76',c,2);
  half += path('M142 64 L133 58 M209 57 L232 53 M373 94 L393 94 L407 103 M460 105 L469 121',c,.9);
  return mirror(half)+crystal(500,69,.83,c)+diamond(500,142,5,8,c,1.4,c);
}

function crystalCorner(c) {
  return path('M5 97 L5 16 L16 5 L97 5 M10 92 L10 22 L22 10 L88 10 M15 53 L15 26 L26 15 L53 15 M15 70 L15 82 L28 91 L73 91 M28 16 L46 34 L37 42 L20 24 M23 8 L60 8',c,.8)+
    diamond(29,29,11,16,c,.9)+diamond(29,29,5,10,c,.6,c)+
    path('M39 37 L58 55 L81 55 L88 62 M60 55 L67 62 L81 62',c,.7)+diamond(82,62,2,3,c,.6,c);
}

function compass(x,y,s,c) {
  return group(
    poly('0,-100 12,-19 72,0 13,13 0,100 -12,18 -72,0 -14,-13',INK,1.5) +
    poly('0,-100 0,0 -12,-19',INK,1,INK) + poly('0,100 0,0 13,13',c,1,c) +
    poly('72,0 0,0 13,-13',c,1,c) + poly('-72,0 0,0 -14,13',INK,1,INK) +
    poly('0,-25 25,0 0,25 -25,0',INK,1.3,'#fffaf2')+
    path('M-33 -33 L33 33 M-33 33 L33 -33',INK,1.5)+circle(0,0,8,INK,1.2,c)+
    path('M0 -61 L0 -28 M28 0 L51 0 M0 28 L0 61 M-28 0 L-51 0',INK,.8),`translate(${x} ${y}) scale(${s})`);
}

function thrillerOpener(c) {
  const half = path('M30 265 L30 24 L154 24 M51 187 L51 64 L394 64 M54 91 L54 68 L82 68',INK,2.1)+
    line(55,60,391,60,INK,.65)+poly('56,76 80,76 56,101',INK,1,INK)+
    path('M32 25 L31 164 M25 245 L25 271',c,1.1);
  return mirror(half)+compass(500,115,1.04,c);
}

function thrillerDivider(c) {
  let half = path('M75 98 L405 98 L423 102 L411 108 L123 104 M122 63 L423 63 L396 69 L245 69 L161 66',INK,1.2)+
    poly('337,94 401,94 411,100 395,106',INK,1,INK)+
    diamond(433,83,8,4,c,1,c);
  return mirror(half)+diamond(500,81,28,71,c,1.7,c)+
    poly('500,28 510,80 500,120 489,81',INK,1.5,INK)+line(500,24,500,48,'#fffaf2',1.1);
}

function fingerprint(c) {
  let art = '';
  // Offset nested arches stop at different heights, leaving characteristic
  // ridge endings and a central whorl rather than concentric closed ovals.
  for (let i=0;i<10;i++) {
    const left=13+i*3.05, right=88-i*3.05, top=9+i*3.25, bottom=68+i*2;
    art += path(`M${left} ${bottom} C${left-8} ${top+23} ${left+4} ${top} 49 ${top} C${right-6} ${top} ${right+7} ${top+17} ${right} ${top+43} C${right-6} ${top+60} ${right-10} ${bottom+9} ${right-5} ${bottom+13}`,INK,.9);
  }
  art += path('M47 77 C36 66 40 55 46 50 C54 43 65 54 59 63 C55 70 56 83 67 91 M49 63 C44 59 48 52 52 55 C57 58 50 64 49 70 C48 79 52 87 57 91 M15 75 Q17 83 25 91 M20 72 Q22 83 32 94 M26 70 Q28 83 38 94 M31 72 Q33 85 44 95 M37 73 Q39 85 50 93 M76 69 Q73 81 80 85 M80 61 Q82 70 87 74',INK,.85);
  return art + path('M58 23 C74 27 77 41 73 54 M24 44 C22 56 25 63 27 66',c,.65);
}

function thrillerCorner(c) {
  return path('M6 94 L6 6 L94 6 M11 85 L11 16 L16 11 L85 11 M18 73 L18 20 L74 20',INK,.85)+
    poly('11,75 11,88 27,88',INK,.7,INK)+poly('73,11 88,11 88,28',INK,.7,INK)+
    line(6,50,6,65,c,1.3)+line(50,6,65,6,c,1.1)+diamond(6,58,1.6,5,c,.6,c);
}

function astrolabe(x,y,s,c) {
  let geometry=circle(0,0,66,c,2.1)+circle(0,0,77,GOLD,1.5)+circle(0,0,87,c,.85)+
    ellipse(0,0,34,76,c,1.3)+ellipse(0,0,76,31,GOLD,1.2)+
    poly('0,-110 76,0 0,110 -76,0',c,1.3)+poly('0,-94 58,0 0,94 -58,0',GOLD,.9)+
    path('M-89 0 L89 0 M0 -100 L0 100',c,.85);
  for(let angle=0;angle<360;angle+=30){
    const a=angle*Math.PI/180;
    geometry+=line(Math.sin(a)*78,Math.cos(a)*78,Math.sin(a)*84,Math.cos(a)*84,GOLD,1);
  }
  geometry += poly('0,-34 8,-8 30,0 8,7 0,34 -8,7 -30,0 -8,-8',c,1.4,'#fffaf2')+
    poly('0,-25 5,0 0,23 -5,0',GOLD,1,GOLD)+circle(0,0,4,c,1,c)+
    diamond(0,-108,4,7,GOLD,1)+diamond(0,108,4,7,GOLD,1);
  return group(geometry,`translate(${x} ${y}) scale(${s})`);
}

function celestialOpener(c) {
  return circle(288,133,111,c,2.1)+circle(500,133,125,GOLD,1.6)+circle(712,133,111,GOLD,1.8)+
    path('M222 43 Q325 -19 392 44 M618 50 Q706 -7 784 39 M387 221 Q490 271 606 220 M192 166 Q128 203 70 258 M806 166 Q872 203 930 258',GOLD,.75)+
    astrolabe(500,127,1.02,c)+circle(180,133,8,c,2,'#fffaf2')+circle(820,133,8,c,2,'#fffaf2')+
    circle(180,133,3,GOLD,1,GOLD)+circle(820,133,3,GOLD,1,GOLD)+
    dots([[406,39],[593,40],[392,224],[609,218]],GOLD,2.1);
}

function celestialDivider(c) {
  return line(85,80,412,80,c,1.7)+line(588,80,915,80,c,1.7)+
    astrolabe(500,80,.68,c)+circle(264,80,22,c,2.1)+circle(264,80,15,GOLD,1.2)+
    circle(736,80,8,GOLD,1.7,'#fffaf2')+circle(94,80,7,GOLD,1.5)+circle(902,80,15,c,1.8)+
    circle(394,80,5,GOLD,1.1,'#fffaf2')+circle(606,80,5,GOLD,1.1,'#fffaf2')+
    line(94,67,94,93,GOLD,.7)+line(898,80,928,80,c,.8);
}

function clockCorner(c) {
  let art=path('M6 95 L6 31 L31 6 L94 6 M11 89 L11 33 L33 11 L89 11 M18 50 L18 27 L27 18 L50 18',c,.8)+
    circle(28,28,15,c,.85)+circle(28,28,11,GOLD,.7)+ellipse(28,28,7,21,GOLD,.6,'transform="rotate(35 28 28)"')+
    path('M28 18 L28 28 L34 31 M28 6 L28 9 M28 47 L28 50 M6 28 L9 28 M47 28 L50 28 M58 6 L70 11 M6 58 L11 70',c,.7)+
    poly('4,28 28,4 52,28 28,52',GOLD,.55)+circle(28,28,1.4,c,.6,c)+
    dots([[6,78],[78,6]],GOLD,1.1);
  return art;
}

function hourglass(c) {
  return path('M25 8 L75 8 L75 13 L25 13 Z M25 86 L75 86 L75 91 L25 91 Z M29 14 L29 32 Q29 41 45 50 Q29 58 29 70 L29 85 M71 14 L71 32 Q71 41 55 50 Q71 58 71 70 L71 85',INK,1.1)+
    path('M33 16 L67 16 L67 30 Q67 38 50 47 Q33 38 33 30 Z M50 53 Q34 63 33 76 L33 82 L67 82 L67 76 Q66 63 50 53 Z',c,.8)+
    poly('35,30 65,30 50,43',c,.65,c,'fill-opacity=".65"')+
    poly('35,80 65,80 50,63',GOLD,.6,GOLD,'fill-opacity=".7"')+
    path('M50 47 L50 57 M37 18 L37 26 M38 69 L37 76 M62 19 L62 26',GOLD,.65)+
    line(26,6,74,6,c,.6)+line(26,94,74,94,c,.6);
}

function rails(genre,c) {
  let art='';
  if(genre==='dark-fantasy') {
    art=mirror(path('M28 202 L28 1665 Q28 1735 106 1748 L301 1748 M34 236 L34 1661 Q36 1729 114 1738 L269 1738',c,2)+
      path('M28 1605 L17 1643 L23 1691 L40 1718 M28 1628 L54 1680 L38 1720 L98 1746 M34 1663 L76 1688 L65 1721 L125 1748 M19 1749 L19 1713 L55 1730 L55 1758 Z',c,1.6)+
      path('M32 1710 Q49 1718 63 1704 Q57 1731 81 1735 M58 1731 Q83 1712 106 1745 M63 1740 L87 1713 L106 1748',c,1.1));
  } else if(genre==='sci-fi') {
    art=mirror(path('M30 25 L30 990 M30 1020 L30 1676 M44 30 L44 395 M25 195 L25 476 M30 1699 L30 1748 L118 1748 L141 1734 L402 1734 M35 1717 L54 1717 L64 1727 L108 1727',c,1.6)+
      path('M44 57 L44 142 L30 166 M30 438 L42 455 L42 503 M30 1610 L38 1620 L38 1661 M35 1742 L80 1742 L90 1737',c,.9)+
      circle(30,166,7,c,1.6)+circle(30,438,6,c,1.5,c)+diamond(44,196,6,12,c,1.5)+
      dots([[30,25],[44,30],[30,1020],[25,476],[30,1676],[71,1742]],c,2));
  } else if(genre==='litrpg') {
    art=mirror(path('M29 129 L29 1663 L84 1729 L407 1729 M39 177 L39 493 M39 1370 L39 1649 L98 1717 L386 1717 M23 210 L23 502 M23 1405 L23 1609',c,1.6)+
      path('M29 296 L45 318 L34 347 L29 360 M29 1380 L44 1355 L38 1339 M29 1550 L47 1580 L43 1600 M56 1681 L69 1677 L112 1717 M97 1701 L142 1701 L163 1717',c,1.3)+
      diamond(29,860,9,24,c,1.8)+diamond(55,1730,17,25,c,1.6)+diamond(55,1730,8,14,c,1.1,c)+
      diamond(407,1729,7,7,c,1.5,c));
  } else if(genre==='thriller') {
    art=mirror(path('M27 24 L27 1739 L125 1739 M27 286 L27 1592 M47 1700 L47 1718 L111 1718 M32 311 L32 1438',INK,1.7)+
      line(35,315,35,1370,INK,.65)+line(27,1477,27,1602,c,1.6)+
      diamond(27,1486,3.5,18,c,1,c)+diamond(27,250,3.5,18,c,1,c)+
      poly('47,1718 78,1718 47,1690',INK,1,INK)+dots([[27,1625],[27,1426]],c,2));
  } else {
    art=mirror(path('M29 94 L29 293 M29 327 L29 1437 M29 1510 L29 1659 L77 1729 L408 1729 M41 90 L41 192 M41 1637 L41 1665 L91 1717 L283 1717',c,1.3)+
      path('M29 103 L35 89 L62 71 M29 1624 Q13 1669 41 1700 M53 1740 L76 1750 L111 1736 M122 1729 L149 1737 L245 1737',GOLD,1)+
      circle(29,345,11,c,1.4)+circle(29,345,5,GOLD,.9)+circle(29,1452,5,c,1,c)+
      dots([[29,379],[29,399],[29,1490]],GOLD,2));
    art+=group(clockCorner(c),'translate(9 1729) scale(.65) rotate(-90)')+
      group(clockCorner(c),'translate(991 1729) scale(-.65 .65) rotate(-90)')+
      group(clockCorner(c),'translate(9 14) scale(.65)')+
      group(clockCorner(c),'translate(991 14) scale(-.65 .65)');
  }
  return art;
}

function folio(genre,c) {
  if(genre==='dark-fantasy')return mirror(line(306,50,421,50,c,1.5)+diamond(390,50,10,13,c,1.3,c)+path('M353 50 L387 44 L387 56 Z',c,.8));
  if(genre==='sci-fi')return mirror(line(66,50,419,50,c,1.6)+circle(246,50,14,c,1.8)+path('M66 38 L83 38 L94 50 L84 62 L66 62 M68 43 L76 43 M68 57 L76 57',c,1.2)+dots([[110,50],[128,50]],c,2));
  if(genre==='litrpg')return mirror(path('M81 35 L125 67 L374 67 L415 50 M100 35 L140 56 L388 56',c,1.5)+diamond(402,56,8,9,c,1.5)+diamond(340,56,5,5,c,1.2,c));
  if(genre==='thriller')return mirror(line(83,50,419,50,INK,1.5)+line(112,54,360,54,INK,.6)+diamond(395,50,9,4,c,1,c));
  return mirror(line(87,50,417,50,c,1.2)+circle(405,50,12,GOLD,1.5)+circle(274,50,13,c,1.6)+circle(274,50,7,GOLD,.8)+dots([[112,50],[149,50]],GOLD,2));
}

function artwork(genre,part,accent) {
  if(!Object.hasOwn(DEFAULTS,genre))return '';
  const c=/^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(accent||'')?accent:DEFAULTS[genre];
  let art='';
  if(part==='frame')art=rails(genre,c);
  else if(part==='folio')art=folio(genre,c);
  else if(genre==='dark-fantasy')art={opener:()=>cathedral(c),divider:()=>gothicDivider(c),corner:()=>gothicCorner(c),icon:()=>group(gothicGem(0,0,.59,c,true),'translate(50 50)')+path('M50 7 L37 32 L20 50 L37 68 L50 93 L63 68 L80 50 L63 32 Z',c,1.1)}[part]?.()||'';
  else if(genre==='sci-fi')art={opener:()=>orbits(c),divider:()=>orbitDivider(c),corner:()=>circuitCorner(c),icon:()=>planet(50,50,28,c,1.05)+circle(50,50,37,c,.85)+circle(50,50,42,c,.5)+path('M50 4 L50 15 M50 85 L50 96 M4 50 L15 50 M85 50 L96 50',c,.75)+dots([[23,23],[77,77]],c,1.3)}[part]?.()||'';
  else if(genre==='litrpg')art={opener:()=>crystalArchitecture(c),divider:()=>crystalDivider(c),corner:()=>crystalCorner(c),icon:()=>crystal(50,50,.65,c,true)}[part]?.()||'';
  else if(genre==='thriller')art={opener:()=>thrillerOpener(c),divider:()=>thrillerDivider(c),corner:()=>thrillerCorner(c),icon:()=>fingerprint(c)}[part]?.()||'';
  else if(genre==='regression')art={opener:()=>celestialOpener(c),divider:()=>celestialDivider(c),corner:()=>clockCorner(c),icon:()=>hourglass(c)}[part]?.()||'';
  return art ? `<g stroke-linecap="round" stroke-linejoin="round">${art}</g>`:'';
}

module.exports={artwork};

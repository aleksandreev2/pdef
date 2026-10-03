'use strict';

// All motifs are expanded as ordinary SVG paths. Keeping them self-contained
// lets the same fine line drawing travel through PDF, EPUB and raster exports.
const path = (d, width = 1.8, fill = 'none', opacity = 1) => `<path d="${d}" stroke-width="${width}" fill="${fill}"${opacity === 1 ? '' : ` opacity="${opacity}"`}/>`;
const group = (transform, contents) => `<g transform="${transform}">${contents}</g>`;
const circle = (x, y, r, width = 1.5, fill = 'none', opacity = 1) => `<circle cx="${x}" cy="${y}" r="${r}" stroke-width="${width}" fill="${fill}" opacity="${opacity}"/>`;
const ink = '#735023';

function leaf(x, y, angle, scale = 1, shade = 0) {
  return group(`translate(${x} ${y}) rotate(${angle}) scale(${scale})`,
    (shade ? path('M0 0 C-12-12-11-29 0-40 C8-24 11-11 0 0Z', 1.3, 'inherit', shade) : '') +
    path('M0 0 C-12-12-11-29 0-40 C8-24 11-11 0 0Z', 1.3) +
    path('M0 0 Q-3-19 0-37 M-1-12 L-6-19 M-1-22 L4-29', .8));
}
function star(x, y, scale = 1) {
  return group(`translate(${x} ${y}) scale(${scale})`,
    path('M0-80 L8-22 35-35 22-8 80 0 22 8 35 35 8 22 0 80-8 22-35 35-22 8-80 0-22-8-35-35-8-22Z', 1.8) +
    path('M0-80 V80 M-80 0 H80 M-35-35 L35 35 M35-35 L-35 35 M0-80 L-8-22 0 0 8 22 0 80 M-80 0 L-22 8 0 0 22-8 80 0', .9) +
    path('M-3-35 L-11-63 M3-35 L11-63 M35-3 L63-11 M35 3 L63 11 M3 35 L11 63 M-3 35 L-11 63 M-35 3 L-63 11 M-35-3 L-63-11 M19-19 L43-43 M-19-19 L-43-43 M19 19 L43 43 M-19 19 L-43 43', .65) +
    circle(0, 0, 4, 1, 'inherit'));
}
function diamond(x, y, size = 8) {
  return path(`M${x} ${y-size} L${x+size*.65} ${y} ${x} ${y+size} ${x-size*.65} ${y}Z`, 1.5) + circle(x,y,1.8,.6,'inherit');
}

function rocaille() {
  return path('M3 96 C-3 68 10 52 27 47 C41 41 50 47 42 56 C32 65 19 49 26 40 C37 27 70 25 94 3 M6 98 C37 93 57 95 79 98 M4 6 H100 M6 4 V100', 2) +
    path('M8 80 C20 72 34 79 42 93 C24 86 9 87 8 80Z M11 65 C26 65 40 67 51 82 C34 81 19 74 11 65Z M37 43 C42 19 57 14 69 16 C61 34 52 35 37 43Z M51 34 C52 19 49 12 43 8 C37 24 40 33 51 34Z M13 29 C10 13 14 7 21 7 C32 8 33 20 25 21 C18 21 16 15 20 13 M26 8 C40 6 41 12 36 16', 1.3) +
    path('M16 83 Q29 83 39 92 M16 66 Q36 71 46 79 M41 38 Q55 22 65 18 M17 39 Q12 48 8 54', .8) +
    circle(8, 8, 2.4, .8, 'inherit') + circle(8, 39, 1.8, .8, 'inherit');
}

function fantasyVine() {
  let result = path('M0 155 C18 104 44 78 78 66 C139 45 213 71 275 25 C290 15 305 10 325 7', 2.5) +
    path('M5 142 C18 106 39 108 37 83 M32 105 C44 70 48 36 73 21 M70 70 C87 88 89 110 106 111 M100 60 C130 39 136 23 143 2 M145 61 C158 78 179 80 187 97 M192 59 C218 30 234 19 250 12 M249 39 C252 60 270 70 277 81', 1.6) +
    path('M121 62 C111 71 111 87 125 87 C137 86 134 72 127 73 M200 55 C193 43 194 31 204 31 C215 31 214 42 207 44', 1.1);
  for (const [x,y,a,s] of [[14,126,30,.75],[34,105,75,.7],[39,83,5,.7],[49,55,35,.75],[69,28,-10,.8],[84,87,-65,.65],[99,105,-30,.55],[110,58,70,.7],[132,32,-5,.8],[144,9,15,.65],[167,79,-60,.6],[187,96,-25,.65],[201,53,55,.65],[222,31,40,.7],[247,15,10,.6],[268,68,-45,.65],[290,18,50,.55],[312,10,60,.55]]) result += leaf(x,y,a,s);
  return result;
}
function feather() {
  return path('M18 90 C26 68 33 44 75 12 C70 43 54 65 28 73 C22 76 20 86 18 90Z', 1.2) +
    path('M18 91 Q34 52 73 14 M27 73 L35 55 M30 67 L49 57 M32 61 L49 41 M37 54 L58 45 M43 44 L59 28 M47 40 L64 34 M53 31 L68 23 M27 78 L24 87', .65) +
    path('M33 67 Q39 60 51 56 M44 52 Q50 42 60 39', .9);
}
function fantasy(part) {
  if (part === 'opener') return group('translate(60 68)', fantasyVine()) + group('translate(940 68) scale(-1 1)', fantasyVine()) + star(500,112,1.12);
  if (part === 'divider') return group('translate(175 58) scale(.82 .65)',fantasyVine()) + group('translate(825 58) scale(-.82 .65)',fantasyVine()) + star(500,80,.56) + star(110,80,.09) + star(890,80,.09);
  if (part === 'icon') return feather();
  if (part === 'corner') return rocaille();
  if (part === 'folio') return path('M300 51 H412 M588 51 H700',1.2) + diamond(405,51,9) + diamond(595,51,9) + path('M300 48 H372 M628 48 H700',.7);
  if (part === 'frame') return path('M30 149 V1601 M970 149 V1601 M125 26 H430 M570 26 H875 M125 1750 H240 M760 1750 H875',1.5) +
    group('translate(22 22)',rocaille()) + group('translate(978 22) scale(-1 1)',rocaille()) + group('translate(22 1756) scale(1 -1)',rocaille()) + group('translate(978 1756) scale(-1 -1)',rocaille()) +
    group('translate(28 105) scale(.14 .8)',fantasyVine()) + group('translate(972 105) scale(-.14 .8)',fantasyVine()) + diamond(30,302,6) + diamond(970,302,6);
  return '';
}

function moon(x, y, radius) {
  // Two explicit arcs produce a true crescent without a white masking disc.
  return path(`M${x+radius*.52} ${y-radius*.91} A${radius} ${radius} 0 1 0 ${x+radius*.67} ${y+radius*.77} A${radius*.91} ${radius*.91} 0 0 1 ${x+radius*.52} ${y-radius*.91}Z`,1.2,'inherit',.92) +
    path(`M${x-radius*.26} ${y-radius*.76} Q${x-radius*.92} ${y} ${x-radius*.2} ${y+radius*.72}`,.8,'none',.5);
}
function bareBranch() {
  return path('M0 81 C33 76 58 75 92 68 C130 66 166 74 213 80 C244 77 275 83 300 81',2.7) +
    path('M66 74 L84 50 95 37 91 20 M84 51 L67 38 62 22 M94 38 L111 31 128 14 M142 71 L161 50 186 41 196 27 M162 49 L151 33 148 20 M190 41 L211 42 226 30 M236 81 L254 65 264 50 M94 69 L104 92 128 110 133 128 M127 109 L151 106 168 117 M46 77 L33 95 27 113 M214 80 L228 105 245 121 M227 104 L215 115 214 130',1.6) +
    path('M62 22 L47 18 M67 38 L54 42 46 37 M91 20 L97 9 M111 31 L109 20 M128 14 L142 10 M151 33 L140 34 132 27 M186 41 L182 28 168 19 M196 27 L211 21 216 10 M226 30 L235 26 M264 50 L257 37 259 25 M264 50 L279 44 286 33 M104 92 L90 107 89 121 M151 106 L165 94 177 92 M133 128 L146 133 M245 121 L259 124 M33 95 L17 96 9 103',.85);
}
function horrorTree() {
  return path('M23 700 C28 587 15 491 33 385 C43 330 31 275 48 225 C60 192 60 157 74 129 C90 99 120 91 137 58 C147 38 143 13 151 1 L142 3 C145 41 122 66 104 81 C80 98 65 120 58 148 C48 177 40 198 36 220 C23 271 25 318 26 372 C12 461 19 555 15 700Z',1.2,'inherit',.94) +
    path('M48 225 C65 194 83 180 125 179 C169 177 207 198 249 180 M75 141 C115 142 145 119 180 127 C211 132 239 151 282 145 M98 94 C143 98 174 80 203 58 L224 32 M27 380 C47 349 63 333 82 328 M24 480 C36 451 61 429 77 423 M28 296 L59 265 78 254 M58 174 L45 145 38 102 M137 60 L120 41 107 12',3) +
    path('M125 179 L142 153 141 133 M169 180 L187 159 201 147 M207 191 L228 203 252 204 M249 180 L270 167 293 166 M282 145 L301 132 326 124 M242 142 L254 116 268 111 M180 127 L193 104 192 83 M148 126 L149 106 133 95 M203 58 L229 55 250 38 M174 80 L180 52 172 32 M104 82 L83 57 81 28 M45 145 L25 124 19 103 M38 102 L39 75 26 53 M78 254 L80 233 67 221 M63 333 L73 309 72 288 M61 429 L67 402 82 388',1.45) +
    path('M141 133 L127 119 M141 150 L156 139 170 136 M187 159 L181 145 M228 203 L231 221 244 234 M270 167 L274 150 286 143 M301 132 L302 116 315 108 M254 116 L242 104 241 90 M193 104 L211 100 225 89 M229 55 L238 65 261 65 M250 38 L251 22 266 10 M180 52 L195 37 212 31 M172 32 L172 14 M83 57 L68 48 60 26 M81 28 L88 15 84 3 M39 75 L54 61 59 39 M26 53 L13 43 13 22 M73 309 L84 300 M67 402 L52 391 50 374 M28 296 L14 275 13 250',.85);
}
function horrorCorner() {
  return path('M6 90 V6 H90 M13 70 V17 H70 M6 37 C16 22 24 28 23 35 C22 45 9 48 7 35 M37 6 C22 16 28 24 35 23 C45 22 48 9 35 7 M12 14 L28 30 M17 17 Q23 7 32 11 Q30 22 17 17Z',1.2) + path('M8 63 L16 54 23 50 M63 8 L54 16 50 23 M12 84 L17 79',.6) + circle(8,8,2,1,'inherit');
}
function horror(part) {
  if (part === 'opener') return group('translate(60 -18) scale(.97 .65)',horrorTree()) + moon(505,105,74) + group('translate(720 49) scale(.7 .65)',bareBranch());
  if (part === 'divider') return group('translate(120 0)',bareBranch()) + group('translate(880 0) scale(-1 1)',bareBranch()) + moon(500,80,36);
  if (part === 'icon') return moon(50,50,36);
  if (part === 'corner') return horrorCorner();
  if (part === 'folio') return path('M305 50 H411 M589 50 H695',1) + path('M378 50 L408 46 408 54Z M622 50 L592 46 592 54Z',.6,'inherit') + circle(414,50,2.2,.7,'inherit') + circle(586,50,2.2,.7,'inherit');
  if (part === 'frame') return group('translate(12 12) scale(.9 .7)',horrorTree()) + path('M28 485 C16 820 36 920 25 1050 S32 1350 27 1468 M975 80 L970 250 975 430 972 490 978 640 970 770 974 990 970 1250 976 1430 970 1665 M575 25 H938 M41 1755 H254 M748 1755 H954',1.2) +
    group('translate(24 1756) scale(.8 -.8)',horrorCorner()) + group('translate(977 1756) scale(-.8 -.8)',horrorCorner()) + group('translate(977 23) scale(-.8 .8)',horrorCorner()) +
    path('M853 33 V93 M932 42 V134 M903 29 V58 M965 647 L954 632 950 620 M976 1050 L962 1029 960 1015 M975 1400 L959 1386 956 1369 M27 1300 L41 1270 55 1250 M25 1310 L16 1288',.8) + diamond(853,99,5) + circle(932,139,2,.8,'inherit') + circle(903,64,1.6,.7,'inherit');
  return '';
}

function rose() {
  return path('M0-8 C-14-19-28-12-24 1 C-35 9-21 28-11 24 C-7 35 12 31 17 21 C31 21 36 4 24-3 C27-16 9-28 0-8Z',1.5,'inherit',.18) +
    path('M0-8 C-14-19-28-12-24 1 C-35 9-21 28-11 24 C-7 35 12 31 17 21 C31 21 36 4 24-3 C27-16 9-28 0-8Z M0-8 C11-11 19-2 14 6 C7 17-9 13-10 4 C-12-4-5-12 0-8Z M-1-6 C5-9 10-2 7 3 C3 10-8 9-7 1 C-6-4-2-3 1-1 L3 3 M-21-7 C-15-7-15 11-6 16 C5 23 21 12 24 3 M-24 1 C-24 12-18 18-11 24 M-11 24 C-7 21-11 16-17 13 M17 21 C15 17 11 17 6 19 M-3-16 C9-24 18-15 19-11',1.3) + path('M-14-7 Q-24 10-9 16 M17-1 Q20 10 10 15 M-5-14 Q3-18 10-14',.7);
}
function blossom() {
  let result = '';
  for (let i = 0; i < 7; i++) result += group(`rotate(${i*360/7})`,path('M0 3 C-17-4-23-23-14-31 C-9-35-2-30 0-23 C5-34 15-34 18-24 C21-12 8 0 0 3Z',1.1,'inherit',.14) + path('M0 3 C-17-4-23-23-14-31 C-9-35-2-30 0-23 C5-34 15-34 18-24 C21-12 8 0 0 3Z M0 1 Q-4-13-8-22 M1-2 Q7-13 9-24',.9));
  return result + circle(0,0,5,.9,'inherit',.45) + path('M-4-2 L-10-12 M4-2 L11-10 M2 3 L8 11 M-3 3 L-9 11',.65);
}
function roseVine() {
  let result = path('M6 244 C-15 220 3 199 15 167 C34 113-5 93 25 55 C60 9 122 35 166 52 C217 70 238 25 214 12 C194 1 177 21 190 32 C203 41 219 31 211 24 M31 57 C75 63 107 96 152 80 C169 74 178 61 177 50 M14 164 C34 149 49 123 46 103 M20 84 C6 72 2 59 8 37 M47 34 C37 17 44 4 53 2 M129 41 C143 22 164 16 165 5 M150 80 C137 90 137 105 144 114',2) +
    path('M25 54 C37 33 67 25 85 37 M17 160 Q33 184 33 197 M66 37 C75 21 91 17 105 21 M173 59 C186 54 190 42 188 35 M128 42 C118 62 105 72 88 66 M27 217 C19 229 16 242 18 256',1);
  for (const [x,y,a,s] of [[9,43,-40,.65],[19,79,-30,.7],[26,144,35,.7],[46,114,30,.7],[42,36,-30,.7],[61,29,30,.7],[103,23,75,.65],[123,61,-80,.6],[144,106,-10,.5],[153,24,50,.6],[177,53,55,.55],[20,222,20,.5]]) result += leaf(x,y,a,s);
  return result;
}
function romanceCorner() {
  return path('M6 98 C17 70 3 50 10 29 C20 0 41 12 40 25 C39 40 22 39 22 31 C22 23 31 22 32 26 M13 32 C30 16 56 18 94 11 M13 76 C36 68 38 50 31 44',1.3) + leaf(17,67,55,.55) + leaf(50,16,70,.55) + leaf(72,15,70,.4) + leaf(33,46,-40,.35);
}
function roseSideLeaves() {
  let leaves = '';
  for (const [y, x, direction] of [[270,38,1],[370,28,-1],[452,29,1],[548,43,-1],[641,40,1],[744,27,-1],[850,34,1],[958,25,-1],[1076,39,1],[1170,27,-1],[1280,36,1],[1380,36,-1]]) {
    leaves += path(`M${x} ${y+25} Q${x+direction*10} ${y+8} ${x+direction*13} ${y-20}`,1.15) +
      leaf(x+direction*6,y+8,direction*30,.62,.16) +
      leaf(x+direction*11,y-7,-direction*35,.53,.12) +
      leaf(x+direction*13,y-19,direction*8,.46,.14);
  }
  return leaves;
}
function romance(part) {
  if (part === 'opener') return group('translate(65 28) scale(1.55 .85)',roseVine()) + group('translate(935 28) scale(-1.55 .85)',roseVine()) + group('translate(265 77) scale(1.05)',rose()) + group('translate(735 77) scale(-1.05 1.05)',rose());
  if (part === 'divider') return group('translate(165 128) rotate(-90) scale(.58 1.08)',roseVine()) + group('translate(835 128) rotate(90) scale(-.58 1.08)',roseVine()) + group('translate(500 72) scale(1.4)',blossom());
  if (part === 'icon') return group('translate(50 53) scale(1.02)',blossom());
  if (part === 'corner') return romanceCorner();
  if (part === 'folio') return path('M278 51 C313 62 338 43 361 49 H413 M722 51 C687 62 662 43 639 49 H587',1.2) + diamond(403,49,7) + diamond(597,49,7) + leaf(331,53,80,.35) + leaf(669,53,-80,.35);
  if (part === 'frame') return group('translate(25 17) scale(1.1)',romanceCorner()) + group('translate(975 17) scale(-1.1 1.1)',romanceCorner()) +
    group('translate(108 116) rotate(-14) scale(1.8)',rose()) + group('translate(892 116) rotate(14) scale(-1.8 1.8)',rose()) +
    path('M35 210 C48 173 53 150 87 125 M965 210 C952 173 947 150 913 125',1.65) +
    leaf(66,160,-30,.82,.13) + leaf(76,149,60,.78,.17) + leaf(57,178,25,.66,.12) +
    leaf(934,160,30,.82,.13) + leaf(924,149,-60,.78,.17) + leaf(943,178,-25,.66,.12) +
    roseSideLeaves() + group('translate(1000 0) scale(-1 1)',roseSideLeaves()) +
    path('M41 153 C5 265 67 354 30 454 C13 507 70 550 41 641 C18 737 51 789 35 893 C18 1004 57 1069 28 1161 C10 1252 65 1330 41 1439 M959 153 C995 265 933 354 970 454 C987 507 930 550 959 641 C982 737 949 789 965 893 C982 1004 943 1069 972 1161 C990 1252 935 1330 959 1439',1.6) +
    path('M35 430 Q64 418 73 381 M42 631 Q62 603 62 582 M36 891 L20 862 14 842 M28 1158 Q58 1129 69 1108 M41 1404 Q19 1386 19 1364 M965 430 Q936 418 927 381 M958 631 Q938 603 938 582 M964 891 L980 862 986 842 M972 1158 Q942 1129 931 1108 M959 1404 Q981 1386 981 1364',.9) +
    leaf(64,409,20,.45) + leaf(62,594,15,.4) + leaf(20,864,-25,.4) + leaf(57,1128,25,.4) + leaf(936,409,-20,.45) + leaf(938,594,-15,.4) + leaf(980,864,25,.4) + leaf(943,1128,-25,.4) +
    group('translate(25 1750) scale(1 -.37)',roseVine()) + group('translate(975 1750) scale(-1 -.37)',roseVine());
  return '';
}

function acanthus() {
  return path('M0 52 C-6 35-7 23-21 10 C-35-2-45 1-45-10 C-44-21-31-18-28-10 C-20 4-10 7-11-4 C-13-23-28-32-23-42 C-14-51-4-21 0-17 C-2-38-17-55-12-65 L0-84 12-65 C17-55 2-38 0-17 C4-21 14-51 23-42 C28-32 13-23 11-4 C10 7 20 4 28-10 C31-18 44-21 45-10 C45 1 35-2 21 10 C7 23 6 35 0 52Z',2,'inherit',.2) +
    path('M0 52 C-6 35-7 23-21 10 C-35-2-45 1-45-10 C-44-21-31-18-28-10 C-20 4-10 7-11-4 C-13-23-28-32-23-42 C-14-51-4-21 0-17 C-2-38-17-55-12-65 L0-84 12-65 C17-55 2-38 0-17 C4-21 14-51 23-42 C28-32 13-23 11-4 C10 7 20 4 28-10 C31-18 44-21 45-10 C45 1 35-2 21 10 C7 23 6 35 0 52Z M0-77 V46 M-10-63 Q-1-32-4-9 M10-63 Q1-32 4-9 M-22-36 Q-8-8-6 13 M22-36 Q8-8 6 13 M-40-12 Q-14 7-10 24 M40-12 Q14 7 10 24 M-11 29 Q-26 23-29 30 C-31 42-15 39-13 34 M11 29 Q26 23 29 30 C31 42 15 39 13 34',1.3) +
    path('M-2-52 L-8-59 M2-52 L8-59 M-10-13 L-18-20 M10-13 L18-20 M-17 9 L-27 7 M17 9 L27 7',.7);
}
function scrollwork() {
  return path('M0 61 C27 62 40 39 68 22 C112-5 149 6 154 31 C159 55 131 61 119 48 C106 33 118 21 130 25 C139 28 134 41 127 37 M38 55 C74 47 74 5 107 8 M64 44 C67 74 42 86 34 72 C25 58 36 51 44 57 C52 64 44 70 41 65 M146 19 C168 20 171 40 185 49 C201 60 217 64 248 61 M181 45 C178 17 168 7 157 10 C141 14 144 26 152 27 C160 27 161 20 156 17',2.4) +
    path('M1 64 H251 M16 63 C7 63 2 49 8 47 C14 44 20 55 16 63 M220 61 C240 38 233 25 222 30 C212 37 224 42 226 36 M73 35 C65 20 61 18 51 18 C53 31 61 36 73 35Z M87 22 C83 8 83 3 92-3 C100 9 97 15 87 22Z M168 27 C180 17 184 12 192 14 C190 26 182 31 168 27Z',1.3) + path('M52 21 L71 34 M92 1 L88 20 M173 26 L189 17 M116 14 Q147 14 149 36 M120 48 Q139 63 156 43 M53 52 Q36 45 28 57',.8);
}
function capital() {
  return path('M-38 0 H38 V9 H-38Z M-34 9 C-52 4-51 26-40 29 C-29 32-27 18-35 17 C-42 16-43 24-37 24 M34 9 C52 4 51 26 40 29 C29 32 27 18 35 17 C42 16 43 24 37 24 M-29 13 H29 L21 40 H-21Z M-22 40 H22 V46 H-22Z',1.4) +
    path('M-18 13 Q-24 24-18 36 M18 13 Q24 24 18 36 M-11 14 L-7 35 M11 14 L7 35 M0 14 V36 M-37 5 H37 M-21 43 H21',.8) + circle(0,23,5,1.1) + circle(-16,22,3,.8) + circle(16,22,3,.8);
}
function columnIcon() {
  return group('translate(50 10) scale(.83)',capital()) + path('M32 49 V84 H68 V49 M36 49 V82 M42 49 V82 M49 49 V82 M56 49 V82 M63 49 V82 M28 85 H72 V91 H28Z M25 92 H75',1.15);
}
function historical(part) {
  if (part === 'opener') return group('translate(130 141) scale(1.32 1)',scrollwork()) + group('translate(870 141) scale(-1.32 1)',scrollwork()) + group('translate(500 147) scale(1.68)',acanthus()) + group('translate(458 174) rotate(-32) scale(.65)',acanthus()) + group('translate(542 174) rotate(32) scale(.65)',acanthus()) + path('M98 206 H440 M560 206 H902',1.3);
  if (part === 'divider') return group('translate(155 61) scale(1.15 .72)',scrollwork()) + group('translate(845 61) scale(-1.15 .72)',scrollwork()) + group('translate(500 83) scale(.8)',acanthus());
  if (part === 'icon') return columnIcon();
  if (part === 'corner') return rocaille() + group('translate(34 31) scale(.2)',acanthus());
  if (part === 'folio') return path('M284 52 H412 M588 52 H716',1.3) + diamond(402,52,9) + diamond(598,52,9);
  if (part === 'frame') {
    let sides = path('M19 24 H380 M620 24 H981 M20 26 V170 M980 26 V170',2);
    for (const x of [50,950]) {
      sides += group(`translate(${x} 234) scale(.78 1.1)`,capital()) + path(`M${x-16} 286 V1590 M${x+16} 286 V1590`,2) + path(`M${x-10} 287 V1588 M${x-5} 287 V1588 M${x+1} 287 V1588 M${x+7} 287 V1588 M${x+12} 287 V1588`,.9) + path(`M${x-23} 1587 H${x+23} V1597 H${x-23}Z M${x-28} 1599 H${x+28} V1608 H${x-28}Z M${x-19} 1225 H${x+19} V1233 H${x-19}Z`,1.3);
    }
    return sides + group('translate(24 26)',rocaille()) + group('translate(976 26) scale(-1 1)',rocaille()) + group('translate(24 1752) scale(1.05 -1.05)',rocaille()) + group('translate(976 1752) scale(-1.05 -1.05)',rocaille()) + path('M180 1753 H365 M635 1753 H820',1.7) + circle(50,1640,22,1.7) + circle(950,1640,22,1.7) + circle(50,1640,14,1.1) + circle(950,1640,14,1.1);
  }
  return '';
}

function cloud() {
  return path('M0 89 C-6 63 14 47 34 53 C27 32 39 9 61 14 C77-5 110 5 114 25 C137 8 163 27 154 49 C177 37 197 50 192 66 C214 65 219 86 202 91 C186 102 167 91 154 94 C127 96 102 112 78 103 C53 121 35 109 33 96 C20 101 6 100 0 89Z',1.8,'inherit',.14) +
    path('M0 89 C-6 63 14 47 34 53 C27 32 39 9 61 14 C77-5 110 5 114 25 C137 8 163 27 154 49 C177 37 197 50 192 66 C214 65 219 86 202 91 C186 102 167 91 154 94 C127 96 102 112 78 103 C53 121 35 109 33 96 C20 101 6 100 0 89Z M7 88 C-1 66 21 53 36 66 C48 77 33 91 22 85 C14 80 18 70 25 71 C32 72 32 78 28 80 M42 54 C32 33 46 17 63 25 M64 24 C71 5 99 11 105 28 M59 65 C46 53 51 31 68 30 C94 25 114 51 98 71 C83 91 59 73 68 61 C75 49 92 59 85 68 C83 71 79 69 78 67 M119 38 C128 18 153 29 146 46 C143 53 133 55 130 47 C128 39 137 35 141 40 M153 56 C171 44 189 52 183 66 M117 58 C117 73 138 88 151 78 C165 68 155 56 143 59 C134 62 136 73 143 73 C149 73 152 67 147 66 M48 86 C38 99 58 114 72 99 M96 92 C121 98 133 85 154 87 C171 88 176 96 194 86 M182 76 C193 69 205 73 204 81',1.7) +
    path('M10 87 C1 67 16 61 29 63 M38 57 C29 37 40 21 57 21 M64 20 Q84-1 107 19 M58 59 C47 42 62 33 74 35 C97 34 103 58 91 67 M70 43 C85 37 95 52 89 59 M109 35 C116 11 149 15 154 35 M122 42 Q132 24 143 33 M118 65 Q125 91 153 85 M151 63 Q166 69 154 80 M52 92 Q60 106 72 96 M101 99 Q121 104 135 96 M162 90 Q178 100 193 94 M186 66 Q207 59 212 78',.85);
}
function cloudTail() {
  return path('M125 0 C145 36 118 43 86 50 C42 57 36 82 60 98 C92 117 124 88 96 73 C72 60 61 83 78 88 C88 92 94 84 87 81 M119 5 C135 33 105 40 78 46 C38 58 29 86 53 106 C78 128 108 119 118 133 C133 154 104 166 91 183 C64 210 77 231 51 252 M111 7 C126 31 96 35 72 42 C26 56 23 90 49 115 C65 133 95 130 102 138 C117 153 82 164 74 187 C66 210 64 225 50 235',1.5) + path('M127 20 C128 44 92 42 72 57 M47 76 C41 96 62 117 87 105 M109 130 C124 149 107 162 94 171 M81 193 Q80 216 63 229',.7);
}
function cultivationCorner() {
  return group('translate(2 2) scale(.43)',cloud()) + group('translate(-7 15) scale(.42 .3)',cloudTail()) + path('M3 84 V94 H82',1);
}
function cultivation(part) {
  if (part === 'opener') return group('translate(43 8) scale(1.55 1.36)',cloud()) + group('translate(957 8) scale(-1.55 1.36)',cloud()) + group('translate(12 67) scale(.83 .58)',cloudTail()) + group('translate(988 67) scale(-.83 .58)',cloudTail()) + circle(500,86,64,2) + path('M500 87 V225 M497 153 Q500 167 503 153 M494 218 Q500 208 506 218 L501 239 494 225Z',1.7) + circle(500,87,2.3,1,'inherit') + diamond(500,227,10);
  if (part === 'divider') return group('translate(180 25) scale(1.12 .79)',cloud()) + group('translate(820 25) scale(-1.12 .79)',cloud()) + path('M72 83 C103 94 122 50 165 69 M78 81 C109 87 121 61 160 74 M928 83 C897 94 878 50 835 69 M922 81 C891 87 879 61 840 74',1.6) + circle(500,76,34,2.1) + path('M467 82 Q479 109 508 110',1.1) + circle(500,127,1.8,.7,'inherit');
  if (part === 'icon') return group('translate(5 23) scale(.43)',cloud()) + path('M1 64 C10 72 16 52 28 57 M78 61 Q89 49 99 54',.8);
  if (part === 'corner') return cultivationCorner();
  if (part === 'folio') return path('M274 51 H412 M588 51 H726',1.4) + diamond(403,51,7) + diamond(597,51,7) + circle(367,51,2,.7,'inherit') + circle(633,51,2,.7,'inherit');
  if (part === 'frame') return group('translate(10 8) scale(.33)',cloud()) + group('translate(990 8) scale(-.33 .33)',cloud()) + group('translate(-15 104) scale(.48 .8)',cloudTail()) + group('translate(1015 104) scale(-.48 .8)',cloudTail()) +
    path('M28 351 C20 360 32 384 28 418 V1568 M972 351 C980 360 968 384 972 418 V1568 M24 1560 C36 1593 40 1614 31 1640 M976 1560 C964 1593 960 1614 969 1640',1.1) +
    group('translate(25 1662) scale(.83 .77)',cloud()) + group('translate(975 1662) scale(-.83 .77)',cloud()) + path('M198 1740 H308 M692 1740 H802 M969 132 V211',1.4) + circle(969,215,2.5,1,'inherit') + path('M244 57 Q268 49 286 40 M714 40 Q732 49 756 57',.9);
  return '';
}

const families = { fantasy, horror, romance, historical, cultivation };
function artwork(genre, part, accent = ink) {
  const family = families[genre];
  if (!family) return '';
  const colour = /^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(accent) ? accent : ink;
  const drawing = family(part);
  return drawing ? `<g stroke="${colour}" fill="${colour}" stroke-linecap="round" stroke-linejoin="round">${drawing}</g>` : '';
}

module.exports = { artwork };

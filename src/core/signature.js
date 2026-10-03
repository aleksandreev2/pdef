'use strict';
const SVGtoPDF = require('svg-to-pdfkit');
const {genreProfile} = require('./genres');
const organic = require('./artwork/organic');
const geometric = require('./artwork/geometric');

// Единственные координаты рисунков: PDF, электронные книги и UI используют
// одинаковые SVG. Текст книги рисуется отдельно и остаётся выделяемым.
const SIZES = {opener:[1000,280], divider:[1000,160], frame:[1000,1778], icon:[100,100], corner:[100,100], folio:[1000,100]};
const ORGANIC = new Set(['fantasy','horror','romance','historical','cultivation']);
function svgArtwork(part, accent, genre) {
  const profile=genreProfile(genre), color=/^#[0-9a-f]{6}$/i.test(accent)?accent:profile.accent;
  const [w,h]=SIZES[part];
  const art=(ORGANIC.has(profile.id)?organic:geometric).artwork(profile.id,part,color);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="presentation" aria-hidden="true">${art}</svg>`;
}
function drawArtwork(doc, part, x, y, width, height, accent, genre) {
  const warnings=[];
  doc.save();
  SVGtoPDF(doc,svgArtwork(part,accent,genre),x,y,{width,height,assumePt:true,preserveAspectRatio:'none',warningCallback:message=>warnings.push(message)});
  doc.restore();
  if(warnings.length) throw new Error(`Ошибка жанрового SVG (${genre}/${part}): ${warnings.join('; ')}`);
  return height;
}
const openerHeight = width=>width*SIZES.opener[1]/SIZES.opener[0];
const sceneHeight = width=>width*SIZES.divider[1]/SIZES.divider[0];
function drawTitleMark(doc,cx,y,w,accent,genre) {const width=Math.min(w,230);return drawArtwork(doc,'opener',cx-width/2,y,width,openerHeight(width),accent,genre);}
function drawOpenerMark(doc,cx,y,w,accent,genre) {return drawArtwork(doc,'opener',cx-w/2,y,w,openerHeight(w),accent,genre);}
function drawSceneBreak(doc,cx,y,accent,genre,width=210) {return drawArtwork(doc,'divider',cx-width/2,y,width,sceneHeight(width),accent,genre);}
function svgTitleMark(accent,genre) {return svgArtwork('opener',accent,genre);}
function svgSceneBreak(accent,genre) {return svgArtwork('divider',accent,genre);}
function svgPageFrame(accent,genre,geom=null,bodyTop=null) {
  const frame=svgArtwork('frame',accent,genre).replace('<svg ','<svg preserveAspectRatio="none" ');
  if(!geom) return frame;
  // На любой странице тело защищено реальными полями, включая минимум 9 мм.
  const {pageW:w,pageH:h}=geom;
  const left=Math.max(3,geom.left-3), right=Math.max(3,geom.right-3);
  const top=Math.max(5,(bodyTop??geom.contentY)-4), bottom=geom.contentBottom+3;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><defs><clipPath id="frame-clearance"><rect width="${left}" height="${h}"/><rect x="${w-right}" width="${right}" height="${h}"/><rect width="${w}" height="${top}"/><rect y="${bottom}" width="${w}" height="${h-bottom}"/></clipPath></defs><g clip-path="url(#frame-clearance)"><svg x="6" y="6" width="${w-12}" height="${h-12}" viewBox="0 0 1000 1778" preserveAspectRatio="none">${(ORGANIC.has(genreProfile(genre).id)?organic:geometric).artwork(genreProfile(genre).id,'frame',/^#[0-9a-f]{6}$/i.test(accent)?accent:genreProfile(genre).accent)}</svg></g></svg>`;
}
function svgSystemIcon(accent,genre) {return svgArtwork('icon',accent,genre);}
function svgPanelCorner(accent,genre) {return svgArtwork('corner',accent,genre);}
function svgFolio(accent,genre) {return svgArtwork('folio',accent,genre);}
function drawPageFrame(doc,geom,style,{opening=true,bodyTop=geom.contentY}={}) {
  if(!style.signature) return;
  const warnings=[];
  doc.save();
  SVGtoPDF(doc,svgPageFrame(style.accent,style.genre,geom,opening?bodyTop:geom.contentY),0,0,{width:geom.pageW,height:geom.pageH,assumePt:true,warningCallback:message=>warnings.push(message)});
  doc.restore();
  if(warnings.length) throw new Error(`Ошибка рамки SVG: ${warnings.join('; ')}`);
}
function drawKickerRule(doc,cx,y,width,accent) {
  const w=Math.min(106,width*.48);
  doc.save().strokeColor(accent).fillColor(accent).lineWidth(.28);
  doc.moveTo(cx-w/2,y).lineTo(cx-4,y).moveTo(cx+4,y).lineTo(cx+w/2,y).stroke();
  doc.path(`M ${cx} ${y-2.8} L ${cx+2.8} ${y} L ${cx} ${y+2.8} L ${cx-2.8} ${y} Z`).stroke();
  doc.circle(cx,y,.7).fill();
  doc.restore();
}
function drawSystemDecoration(doc,x,y,w,h,style,{continued=false,continuesOnNext=false}={}) {
  // Две тонкие рамки и собственные уголки жанра. На разрыве незамкнуты.
  const angular=style.panel==='angular', cut=angular?6:3;
  doc.save().lineWidth(.4).strokeColor(style.accent);
  doc.moveTo(x,y+cut).lineTo(x,y+h-cut);
  doc.moveTo(x+w,y+cut).lineTo(x+w,y+h-cut);
  if(!continued) doc.moveTo(x,y+cut).lineTo(x+cut,y).lineTo(x+w-cut,y).lineTo(x+w,y+cut);
  if(!continuesOnNext) doc.moveTo(x,y+h-cut).lineTo(x+cut,y+h).lineTo(x+w-cut,y+h).lineTo(x+w,y+h-cut);
  doc.stroke();
  doc.lineWidth(.2).strokeOpacity(.68);
  doc.moveTo(x+3,y+7).lineTo(x+3,y+h-7).moveTo(x+w-3,y+7).lineTo(x+w-3,y+h-7);
  if(!continued) doc.moveTo(x+9,y+3).lineTo(x+w-9,y+3);
  if(!continuesOnNext) doc.moveTo(x+9,y+h-3).lineTo(x+w-9,y+h-3);
  doc.stroke().restore();
  const s=Math.min(12,h/3);
  for(const [cx,cy,sx,sy,draw] of [[x,y,1,1,!continued],[x+w,y,-1,1,!continued],[x,y+h,1,-1,!continuesOnNext],[x+w,y+h,-1,-1,!continuesOnNext]]) {
    if(!draw) continue;
    doc.save().translate(cx,cy).scale(sx,sy);
    drawArtwork(doc,'corner',0,0,s,s,style.accent,style.genre);
    doc.restore();
  }
}
module.exports={drawTitleMark,drawOpenerMark,drawSceneBreak,drawPageFrame,drawArtwork,drawKickerRule,drawSystemDecoration,svgTitleMark,svgSceneBreak,svgPageFrame,svgSystemIcon,svgPanelCorner,svgFolio,openerHeight,sceneHeight};

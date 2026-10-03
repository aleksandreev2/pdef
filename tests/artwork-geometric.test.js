'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { XMLValidator } = require('fast-xml-parser');
const { Resvg } = require('@resvg/resvg-js');
const { artwork } = require('../src/core/artwork/geometric');

const genres = ['dark-fantasy', 'sci-fi', 'litrpg', 'thriller', 'regression'];
const sizes = {opener:[1000,280],divider:[1000,160],frame:[1000,1778],icon:[100,100],corner:[100,100],folio:[1000,100]};
function svg(genre, part, accent) {
  const [w,h]=sizes[part];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${artwork(genre,part,accent)}</svg>`;
}
function paintedPixels(rendered, x0=0, y0=0, x1=rendered.width, y1=rendered.height) {
  const pixels=rendered.pixels;
  let count=0;
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)if(pixels[(y*rendered.width+x)*4+3])count++;
  return count;
}

test('geometric artwork is valid, self-contained SVG and rasterizes at every supported size', () => {
  for(const genre of genres)for(const part of Object.keys(sizes)) {
    const inner=artwork(genre,part,'#386ab2');
    assert.ok(inner.length>100,`${genre}/${part}: missing artwork`);
    assert.doesNotMatch(inner,/<svg|<text|<image|<foreignObject|<filter|\bhref\s*=|currentColor|url\(/i);
    const document=svg(genre,part,'#386ab2');
    assert.equal(XMLValidator.validate(document),true,`${genre}/${part}: malformed SVG`);
    const rendered=new Resvg(document).render();
    assert.deepEqual([rendered.width,rendered.height],sizes[part]);
    const painted=paintedPixels(rendered);
    assert.ok(painted>40,`${genre}/${part}: blank raster`);
    assert.ok(painted<rendered.width*rendered.height*.40,`${genre}/${part}: oversized solid decoration`);
  }
});

test('page frames leave the full body rectangle clear and folios leave room for real page numbers', () => {
  for(const genre of genres) {
    const frame=new Resvg(svg(genre,'frame')).render();
    assert.equal(paintedPixels(frame,90,320,911,1641),0,`${genre}: frame enters text body`);
    assert.ok(paintedPixels(frame,0,320,90,1640)>100,`${genre}: missing left page rail`);
    assert.ok(paintedPixels(frame,911,320,1000,1640)>100,`${genre}: missing right page rail`);
    const folio=new Resvg(svg(genre,'folio')).render();
    assert.equal(paintedPixels(folio,430,0,571,100),0,`${genre}: folio covers page number`);
  }
});

test('all five genre signatures remain visibly distinct and accept a custom accent', () => {
  for(const part of Object.keys(sizes)) {
    assert.equal(new Set(genres.map(genre=>artwork(genre,part))).size,genres.length,`${part}: reused signature`);
  }
  for(const genre of genres)assert.match(artwork(genre,'opener','#12aBcD'),/#12aBcD/);
  assert.equal(artwork('unknown','opener'),'');
  assert.equal(artwork('sci-fi','unknown'),'');
  assert.doesNotMatch(artwork('sci-fi','opener','" onload="bad'),/onload|bad/);
});

'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {clampStyle}=require('../src/core/style');

test('manual front matter settings are bounded and invalid values restore defaults',()=>{
  const style=clampStyle({titleSize:100,titleTopMm:-20,creditSize:'bad',aboutTitleSize:20});
  assert.equal(style.titleSize,36);
  assert.equal(style.titleTopMm,0);
  assert.equal(style.creditSize,10.5);
  assert.equal(style.aboutTitleSize,20);
});

test('front matter preview uses the same PDF renderer with manual text sizes and positions',async t=>{
  const {previewFrontMatter}=require('../src/core/pdf/front-matter-preview');
  const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
  async function title(style) {
    const data=await previewFrontMatter({meta:{title:'Проверка',team:'Команда',teamUrl:'https://example.test'},style});
    const pdf=await pdfjs.getDocument({data:new Uint8Array(data),isEvalSupported:false}).promise;
    t.after(()=>pdf.destroy());
    assert.equal(pdf.numPages,4);
    const {items}=await (await pdf.getPage(2)).getTextContent();
    return items.find(i=>i.str==='Проверка');
  }
  const original=await title({});
  const changed=await title({titleSize:30,titleTopMm:24});
  assert.ok(changed.height>original.height*1.2);
  assert.ok(changed.transform[5]<original.transform[5]-20);
});

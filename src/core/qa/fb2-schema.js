'use strict';
const fs=require('fs/promises'),path=require('path');
const {validateXML,memoryPages}=require('xmllint-wasm');
let schemas;
async function validateFb2(xml) {
  schemas ||= Promise.all(['FictionBook.xsd','FictionBookGenres.xsd','FictionBookLang.xsd','FictionBookLinks.xsd'].map(async fileName=>({fileName,contents:await fs.readFile(path.resolve(__dirname,'../../../assets/schemas/fb2',fileName),'utf8')})));
  const [main,...preload]=await schemas;
  return validateXML({xml:[{fileName:'book.fb2',contents:xml}],schema:[main],preload,maxMemoryPages:memoryPages.GiB});
}
module.exports={validateFb2};

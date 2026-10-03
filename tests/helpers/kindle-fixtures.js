'use strict';
// Tiny real PalmDB/MOBI and KF8 containers, containing only test-authored text.
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; }
function varint(n) { const out = [n & 127 | 128]; while ((n = Math.floor(n / 128))) out.unshift(n & 127); return Buffer.from(out); }
function indexHeader(entries, idxt = 0) { const b = Buffer.alloc(56); b.write('INDX'); b.writeUInt32BE(56, 4); b.writeUInt32BE(idxt, 20); b.writeUInt32BE(entries, 24); b.writeUInt32BE(65001, 28); return b; }
function skelIndex(chunks) {
  const tagx = Buffer.concat([Buffer.from('TAGX'), u32(20), u32(1), Buffer.from([1, 1, 1, 0, 6, 2, 2, 0])]);
  let offset = 0, cursor = 56;
  const entries = [], offsets = [];
  for (let i = 0; i < chunks.length; i++) {
    const name = Buffer.from('SKEL' + String(i).padStart(10, '0'));
    const entry = Buffer.concat([Buffer.from([name.length]), name, Buffer.from([3]), varint(0), varint(offset), varint(chunks[i].length)]);
    offsets.push(cursor); cursor += entry.length; offset += chunks[i].length; entries.push(entry);
  }
  const idxt = Buffer.alloc(4 + offsets.length * 2); idxt.write('IDXT'); offsets.forEach((n, i) => idxt.writeUInt16BE(n, 4 + i * 2));
  return [Buffer.concat([indexHeader(1), tagx]), Buffer.concat([indexHeader(chunks.length, cursor), ...entries, idxt])];
}
function pack(records) {
  const header = Buffer.alloc(78 + records.length * 8 + 2);
  header.write('PDFMaker test'); header.write('BOOKMOBI', 60); header.writeUInt16BE(records.length, 76);
  let offset = header.length;
  records.forEach((r, i) => { header.writeUInt32BE(offset, 78 + i * 8); offset += r.length; });
  return Buffer.concat([header, ...records]);
}
function kindleFixture(htmlSections, opts = {}) {
  const kf8 = opts.kf8 || false;
  const chunks = htmlSections.map(s => Buffer.from(`<html><head>${opts.head || ''}</head><body>${s}</body></html>`, 'utf8'));
  const text = kf8 ? Buffer.concat(chunks) : Buffer.from(`<html><head></head><body>${htmlSections.join('<mbp:pagebreak/>')}</body></html>`, 'utf8');
  const title = Buffer.from(opts.title || 'Тестовая книга', 'utf8');
  const metadata = [u32(503), u32(8 + title.length), title]; let metadataCount=1;
  for(const [type,value] of [[100,opts.author],[524,opts.language]]) if(value) { const data=Buffer.from(value,'utf8'); metadata.push(u32(type),u32(8+data.length),data); metadataCount++; }
  if (opts.images?.length) metadata.push(u32(201), u32(12), u32(0));
  const exth = opts.noExth ? Buffer.alloc(0) : Buffer.concat([Buffer.from('EXTH'), u32(12 + Buffer.concat(metadata).length), u32(metadataCount+(opts.images?.length ? 1 : 0)), ...metadata]);
  const first = Buffer.alloc(264);
  first.writeUInt16BE(opts.compressed ? 2 : 1, 0); first.writeUInt32BE(text.length, 4); first.writeUInt16BE(1, 8); first.writeUInt16BE(4096, 10); first.writeUInt16BE(opts.encrypted ? 2 : 0, 12);
  first.write('MOBI', 16); first.writeUInt32BE(248, 20); first.writeUInt32BE(2, 24); first.writeUInt32BE(65001, 28); first.writeUInt32BE(kf8 ? 8 : 6, 36);
  first.writeUInt32BE(264 + exth.length, 84); first.writeUInt32BE(title.length, 88); first[95] = 25;
  first.writeUInt32BE(0xffffffff, 108); first.writeUInt32BE(opts.noExth ? 0 : 64, 128); first.writeUInt32BE(0xffffffff, 244); first.writeUInt32BE(0xffffffff, 260);
  let packedText = text;
  if (opts.compressed) { const pieces = []; for (let i = 0; i < text.length; i += 8) { const part = text.subarray(i, i + 8); pieces.push(Buffer.from([part.length]), part); } packedText = Buffer.concat(pieces); }
  const records = [Buffer.concat([first, exth, title]), packedText];
  if (kf8) {
    first.writeUInt32BE(2, 192); first.writeUInt32BE(1, 196); first.writeUInt32BE(5, 248); first.writeUInt32BE(3, 252);
    const fdst = Buffer.concat([Buffer.from('FDST'), u32(12), u32(1), u32(0), u32(text.length)]);
    const frag = Buffer.concat([indexHeader(0), Buffer.from('TAGX'), u32(12), u32(1)]);
    records[0] = Buffer.concat([first, exth, title]); records.push(fdst, ...skelIndex(chunks), frag);
  }
  if (opts.images?.length) {
    first.writeUInt32BE(records.length, 108);
    records[0] = Buffer.concat([first, exth, title]);
    records.push(...opts.images);
  }
  return pack(records);
}
module.exports = { kindleFixture };

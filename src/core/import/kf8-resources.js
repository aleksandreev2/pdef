'use strict';
const fs = require('fs');
const path = require('path');

const RESOURCE = /kindle:(flow|embed):(\w+)(?:\?mime=(\w+\/[-+.\w]+))?/gi;
const EXTENSIONS = {
  'image/jpeg':'jpg', 'image/jpg':'jpg', 'image/png':'png', 'image/gif':'gif',
  'image/bmp':'bmp', 'image/svg+xml':'svg', 'image/webp':'webp',
  'text/css':'css', 'application/xml':'xml', 'application/xhtml+xml':'xhtml',
  'text/html':'html', 'font/ttf':'ttf', 'font/otf':'otf', 'font/woff':'woff',
  'font/woff2':'woff2', 'font/eot':'eot',
};

/**
 * KF8 uses base32 for both flow and embed IDs. Reader 0.4.6 uses decimal
 * for flows and base36 for images: a flow such as 000A then loads the whole
 * book at index zero recursively. Resolve resources with the correct radix.
 */
function fixKf8Resources(book, directory) {
  const pending = new Set();
  book.replaceResources = function replaceResources(html) {
    return html.replace(RESOURCE, (uri, kind, id, requestedMime) => {
      if (!/^[0-9a-v]+$/i.test(id)) throw new Error('Повреждён номер ресурса Kindle');
      const index = Number.parseInt(id, 32);
      if (!Number.isSafeInteger(index)) throw new Error('Повреждён номер ресурса Kindle');
      const key = `${kind}:${index}:${(requestedMime || '').toLowerCase()}`;
      if (book.resourceCache.has(key)) return book.resourceCache.get(key);
      if (pending.has(key)) throw new Error('Циклическая ссылка на ресурс Kindle');
      if (pending.size >= 32) throw new Error('Слишком много вложенных ресурсов Kindle');
      pending.add(key);
      try {
        let raw, mime = (requestedMime || '').toLowerCase();
        if (kind === 'flow') {
          // Flow zero is the book body, never a stylesheet or illustration.
          if (index < 1 || index >= book.fdstTable.length) throw new Error('Не найден ресурс Kindle');
          raw = book.loadFlow(index);
        } else {
          const record = book.mobiFile.resourceStart + index - 1;
          if (index < 1 || record >= book.mobiFile.recordsOffset.length) throw new Error('Не найден ресурс Kindle');
          const resource = book.mobiFile.loadResource(index - 1);
          raw = resource.raw;
          mime ||= resource.type;
        }
        if (!raw?.byteLength) throw new Error('Пустой ресурс Kindle');
        let data = Buffer.from(raw);
        if (mime === 'text/css' || mime === 'image/svg+xml') {
          data = Buffer.from(replaceResources(data.toString('utf8')), 'utf8');
        }
        const file = path.join(directory, `${kind}-${index}.${EXTENSIONS[mime] || 'bin'}`);
        fs.writeFileSync(file, data);
        book.resourceCache.set(key, file);
        return file;
      } finally {
        pending.delete(key);
      }
    });
  };
}

module.exports = { fixKf8Resources };

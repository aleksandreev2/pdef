'use strict';
const fs = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');
const METADATA_KEYS = ['subtitle', 'team', 'teamUrl'];

function validDirectory(value) {
  return typeof value === 'string' && path.isAbsolute(value) && !value.includes('\0');
}

function bookMetadata(value) {
  const metadata = {};
  for (const key of METADATA_KEYS) {
    if (typeof value?.[key] === 'string') metadata[key] = value[key];
  }
  return metadata;
}

/** Папка экспорта и сведения о переводе хранятся в профиле приложения. */
function createOutputPreferences(file) {
  let pending = null;
  async function read() {
    try {
      const value = JSON.parse(await fs.readFile(file, 'utf8'));
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) return {};
      throw error;
    }
  }
  function write(change) {
    const saved = (pending || Promise.resolve()).then(async () => {
      const prefs = await read();
      const result = change(prefs);
      await fs.mkdir(path.dirname(file), { recursive: true });
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, JSON.stringify(prefs, null, 2), 'utf8');
        await fs.rename(temporary, file);
      } finally {
        await fs.rm(temporary, { force: true });
      }
      return result;
    });
    const tail = saved.catch(() => {}).finally(() => {
      if (pending === tail) pending = null;
    });
    pending = tail;
    return saved;
  }

  return {
    pendingWrite: () => pending,
    async get() {
      await pending;
      const prefs = await read();
      return validDirectory(prefs.outDir) ? prefs.outDir : null;
    },
    async set(directory) {
      if (!validDirectory(directory)) throw new Error('Выберите папку с абсолютным путём');
      return write(prefs => { prefs.outDir = directory; return directory; });
    },
    async getMetadata() {
      await pending;
      return bookMetadata((await read()).bookMetadata);
    },
    setMetadata(value) {
      const edits = bookMetadata(value);
      return write(prefs => {
        prefs.bookMetadata = { ...bookMetadata(prefs.bookMetadata), ...edits };
      });
    },
  };
}

module.exports = { createOutputPreferences };

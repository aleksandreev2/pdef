'use strict';
const fs = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');

function validDirectory(value) {
  return typeof value === 'string' && path.isAbsolute(value) && !value.includes('\0');
}

/** Выбранная папка хранится в профиле приложения, независимо от открытой книги. */
function createOutputPreferences(file) {
  async function read() {
    try {
      const value = JSON.parse(await fs.readFile(file, 'utf8'));
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) return {};
      throw error;
    }
  }
  return {
    async get() {
      const prefs = await read();
      return validDirectory(prefs.outDir) ? prefs.outDir : null;
    },
    async set(directory) {
      if (!validDirectory(directory)) throw new Error('Выберите папку с абсолютным путём');
      const prefs = await read();
      prefs.outDir = directory;
      await fs.mkdir(path.dirname(file), { recursive: true });
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, JSON.stringify(prefs, null, 2), 'utf8');
        await fs.rename(temporary, file);
      } finally {
        await fs.rm(temporary, { force: true });
      }
      return directory;
    },
  };
}

module.exports = { createOutputPreferences };

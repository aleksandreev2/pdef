'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');

function createBookService(spawn) {
  let worker;
  let nextId = 0;
  const pending = new Map();

  function disconnect(child, error) {
    if (worker !== child) return;
    worker = null;
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  }

  function start() {
    const child = spawn();
    child.on('message', ({ id, progress, result, error }) => {
      if (worker !== child) return;
      const task = pending.get(id);
      if (!task) return;
      if (progress) {
        task.onProgress?.(progress);
        return;
      }
      pending.delete(id);
      if (error) task.reject(new Error(error));
      else task.resolve(result);
    });
    child.on('error', error => disconnect(child, error));
    child.on('exit', () => disconnect(child, new Error('Процесс обработки книги завершился. Повторите разбор исходников.')));
    return child;
  }

  return {
    request(command, value, onProgress) {
      return new Promise((resolve, reject) => {
        worker ||= start();
        const id = ++nextId;
        pending.set(id, { resolve, reject, onProgress });
        try {
          worker.postMessage({ id, command, value });
        } catch (error) {
          pending.delete(id);
          reject(error);
        }
      });
    },
    close() {
      if (!worker) return;
      const child = worker;
      disconnect(child, new Error('Приложение закрывается.'));
      child.kill();
    },
  };
}

function withPreviewUrls(report) {
  if (report.pdf?.path) report.pdf.fileUrl = pathToFileURL(report.pdf.path).href;
  report.versions?.forEach(withPreviewUrls);
  return report;
}

function registerBookHandlers({ ipcMain, utilityProcess, onProgress, bookOperation = operation => operation() }) {
  const service = createBookService(() => utilityProcess.fork(path.join(__dirname, 'book-worker.js'), [process.resourcesPath], {
    serviceName: 'PDFMaker Book',
  }));
  ipcMain.handle('book:analyze', (_event, paths) => bookOperation(() => service.request('analyze', paths, onProgress)));
  ipcMain.handle('book:applyEdits', (_event, edits) => service.request('applyEdits', edits));
  ipcMain.handle('book:addCover', (_event, file) => bookOperation(() => service.request('addCover', file)));
  ipcMain.handle('book:clear', () => service.request('clear'));
  ipcMain.handle('book:previewFrontMatter', (_event, options) => service.request('previewFrontMatter', options));
  ipcMain.handle('book:build', (_event, options) => bookOperation(async () =>
    withPreviewUrls(await service.request('build', options, onProgress))));
  ipcMain.handle('asset:thumbnail', (_event, id) => service.request('assetThumbnail', id));
  return service;
}

module.exports = { createBookService, registerBookHandlers, withPreviewUrls };

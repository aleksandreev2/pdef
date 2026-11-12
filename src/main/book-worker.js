'use strict';

// Electron sets resourcesPath in the utility process. Pass the main process's
// value as well so bundled converter discovery uses the same resources folder.
if (!process.resourcesPath && process.parentPort && process.argv[2]) process.resourcesPath = process.argv[2];

const pipeline = require('../core/pipeline');
const { previewFrontMatter } = require('../core/pdf/front-matter-preview');

function serveBook(port, unwrap = message => message) {
  const commands = new Map([
    ['analyze', pipeline.analyze],
    ['applyEdits', pipeline.applyEdits],
    ['addCover', file => pipeline.addCoverFile(file)],
    ['clear', () => pipeline.clearBook()],
    ['previewFrontMatter', previewFrontMatter],
    ['build', pipeline.build],
    ['assetThumbnail', id => pipeline.assetThumbnail(id)],
  ]);
  let queue = Promise.resolve();
  port.on('message', message => {
    const { id, command, value } = unwrap(message);
    queue = queue.then(async () => {
      try {
        const run = commands.get(command);
        if (!run) throw new Error('Неизвестная операция с книгой.');
        const result = await run(value, progress => port.postMessage({ id, progress }));
        port.postMessage({ id, result });
      } catch (error) {
        port.postMessage({ id, error: error.message || String(error) });
      }
    });
  });
}

if (process.parentPort) serveBook(process.parentPort, event => event.data);

module.exports = { serveBook };

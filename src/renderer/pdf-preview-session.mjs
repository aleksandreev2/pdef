export function createPdfPreviewSession(loadDocument) {
  let cached;
  let activeDraw;
  let revision = 0;

  function releaseDocument() {
    const previous = cached;
    cached = null;
    return previous?.task.destroy().catch(() => {});
  }

  function cancelDraw() {
    activeDraw?.cancel();
    activeDraw = null;
  }

  return {
    async render(url, renderPages) {
      const current = ++revision;
      cancelDraw();
      if (cached?.url !== url) {
        void releaseDocument();
        cached = { url, task: loadDocument(url) };
      }
      const entry = cached;
      const isCurrent = () => current === revision;
      try {
        const doc = await entry.task.promise;
        if (!isCurrent()) return null;
        const pages = await renderPages(doc, {
          isCurrent,
          async draw(task) {
            activeDraw = task;
            try { await task.promise; }
            finally { if (activeDraw === task) activeDraw = null; }
          },
        });
        return isCurrent() ? pages : null;
      } catch (error) {
        if (!isCurrent()) return null;
        void releaseDocument();
        throw error;
      }
    },
    reset() {
      revision++;
      cancelDraw();
      return releaseDocument();
    },
  };
}

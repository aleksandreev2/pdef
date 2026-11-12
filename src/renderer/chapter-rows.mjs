export function createChapterRows(body, createRow, viewKey) {
  const cached = new Map();

  return {
    render(chapters, visible) {
      const ids = new Set(chapters.map(chapter => chapter.id));
      for (const id of cached.keys()) if (!ids.has(id)) cached.delete(id);

      const rows = visible.map(chapter => {
        const key = viewKey(chapter);
        let entry = cached.get(chapter.id);
        if (entry?.chapter !== chapter || entry.key !== key) {
          entry = { chapter, key, row: createRow(chapter) };
          cached.set(chapter.id, entry);
        }
        return entry.row;
      });
      const wanted = new Set(rows);
      for (const row of [...body.children]) if (!wanted.has(row)) row.remove();

      let next = body.firstElementChild;
      for (const row of rows) {
        if (row === next) next = next.nextElementSibling;
        else body.insertBefore(row, next);
      }
    },
  };
}

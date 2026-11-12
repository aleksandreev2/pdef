'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

test('filtering and reordering chapters retain unchanged row elements', async () => {
  const { createChapterRows } = await import('../src/renderer/chapter-rows.mjs');
  const body = {
    children: [],
    get firstElementChild() { return this.children[0] ?? null; },
    insertBefore(row, next) {
      row.remove();
      this.children.splice(next ? this.children.indexOf(next) : this.children.length, 0, row);
    },
  };
  function createRow(chapter) {
    return {
      title: chapter.title,
      get nextElementSibling() { return body.children[body.children.indexOf(this) + 1] ?? null; },
      remove() {
        const index = body.children.indexOf(this);
        if (index >= 0) body.children.splice(index, 1);
      },
    };
  }
  const chapters = [{ id: 'one', title: 'Первый' }, { id: 'two', title: 'Второй' }];
  const rows = createChapterRows(body, createRow, chapter => chapter.title);
  rows.render(chapters, chapters);
  const [first, second] = body.children;

  rows.render(chapters, chapters.slice(1));
  assert.deepEqual(body.children, [second]);
  rows.render(chapters, [chapters[1], chapters[0]]);
  assert.equal(body.children[0], second);
  assert.equal(body.children[1], first);

  chapters[1].title = 'Другой заголовок';
  rows.render(chapters, chapters);
  assert.equal(body.children[0], first);
  assert.equal(body.children[1].title, 'Другой заголовок');
  assert.notEqual(body.children[1], second);
});

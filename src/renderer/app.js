import { accentFromImage } from './accent.js';
import { renderSample, forgetDocument } from './pdf-preview.js';

const api = window.api;
const $ = (id) => document.getElementById(id);

/* ───────────────────────────── состояние ───────────────────────────── */

const state = {
  sources: [],
  chapters: [],
  audit: null,
  stats: null,
  coverCandidates: [],
  cover: null,
  coverDataUrl: null,
  outDir: null,
  report: null,
  busy: false,
  order: [],
};

const KIND_LABEL = {
  chapter: 'Глава',
  prologue: 'Пролог',
  epilogue: 'Эпилог',
  afterword: 'Послесловие',
  illustrations: 'Иллюстрации',
  extra: 'Дополнительно',
};

/* ───────────────────────────── утилиты ───────────────────────────── */

const nf = new Intl.NumberFormat('ru-RU');
const fmt = (n) => nf.format(Math.round(Number(n) || 0));

function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

function bytes(n) {
  if (!n) return '—';
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} КБ`;
  return `${(n / 1048576).toFixed(2)} МБ`;
}

function log(message) {
  const el = $('logContent');
  const time = new Date().toLocaleTimeString('ru-RU');
  el.textContent += `${time}  ${message}\n`;
  el.scrollTop = el.scrollHeight;
}

function setStatus(text) {
  $('statusLine').textContent = text;
}

function setBusy(busy, label) {
  state.busy = busy;
  $('buildBtn').disabled = busy || !state.chapters.some((c) => c.include);
  $('pickFilesBtn').disabled = busy;
  $('pickFolderBtn').disabled = busy;
  $('clearBtn').disabled = busy || !state.sources.length;
  $('progressBar').hidden = !busy;
  if (!busy) $('progressFill').style.width = '0%';
  if (label) setStatus(label);
}

/* ───────────────────────────── источники ───────────────────────────── */

async function addSources(paths) {
  const fresh = paths.filter((p) => p && !state.sources.includes(p));
  if (!fresh.length) return;
  state.sources.push(...fresh);
  renderSourceList();
  await runAnalysis();
}

function renderSourceList() {
  const ul = $('sourceList');
  ul.innerHTML = '';
  for (const p of state.sources) {
    const li = document.createElement('li');
    li.textContent = p;
    li.title = p;
    ul.appendChild(li);
  }
  $('clearBtn').disabled = !state.sources.length;
}

async function runAnalysis() {
  setBusy(true, 'Разбор исходников…');
  log(`Разбор: ${state.sources.length} ${plural(state.sources.length, 'источник', 'источника', 'источников')}`);
  try {
    const result = await api.analyze(state.sources);
    state.chapters = result.summary.chapters;
    state.order = state.chapters.map((c) => c.id);
    state.audit = result.audit;
    state.stats = result.stats;
    state.coverCandidates = result.coverCandidates;
    state.cover = result.cover ? result.cover.assetId : null;

    renderChapters();
    renderAudit();
    renderCoverOptions();
    await refreshCoverPreview();
    // Акцент берётся из обложки сразу: один спокойный цвет на всю книгу.
    if (state.cover) await applyAccentFromCover(true);
    updateOutNameHint();

    const a = result.audit;
    setStatus(
      `${a.included} ${plural(a.included, 'раздел', 'раздела', 'разделов')} · ${fmt(result.stats.words)} слов` +
        (a.gaps.length ? ` · пропусков: ${a.gaps.length}` : '') +
        (a.duplicates.length ? ` · дублей: ${a.duplicates.length}` : ''),
    );
    log(`Разобрано: ${a.total}, в книгу входит ${a.included}, слов ${fmt(result.stats.words)}`);
    for (const w of result.warnings) log(`! ${w}`);
    for (const w of result.fonts) log(`! ${w}`);
  } catch (e) {
    log(`ОШИБКА разбора: ${e.message}`);
    setStatus(`Ошибка: ${e.message}`);
  } finally {
    setBusy(false);
  }
}

/* ───────────────────────────── таблица глав ───────────────────────────── */

function visibleChapters() {
  const q = $('chapterFilter').value.trim().toLowerCase();
  const onlyProblems = $('onlyProblems').checked;
  return state.chapters.filter((ch) => {
    if (onlyProblems && !ch.issues.length) return false;
    if (!q) return true;
    return (
      (ch.title || '').toLowerCase().includes(q) ||
      (ch.sourceName || '').toLowerCase().includes(q) ||
      String(ch.number ?? '').includes(q)
    );
  });
}

function issueClass(text) {
  if (/не разобран|пустой|повреж/i.test(text)) return 'issue bad';
  if (/дубль|другая версия|короче/i.test(text)) return 'issue';
  return 'issue info';
}

function renderChapters() {
  const tbody = $('chapterBody');
  tbody.innerHTML = '';
  const rows = visibleChapters();

  $('tabChaptersCount').textContent = String(state.chapters.filter((c) => c.include).length);

  if (!rows.length) {
    const tr = document.createElement('tr');
    tr.className = 'empty';
    tr.innerHTML = '<td colspan="8">Ничего не найдено</td>';
    tbody.appendChild(tr);
    return;
  }

  for (const ch of rows) {
    const tr = document.createElement('tr');
    tr.dataset.id = ch.id;
    tr.draggable = true;
    if (!ch.include) tr.classList.add('off');

    const on = document.createElement('td');
    on.className = 'col-on';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = ch.include;
    cb.title = 'Включить раздел в книгу';
    cb.addEventListener('change', () => {
      ch.include = cb.checked;
      tr.classList.toggle('off', !cb.checked);
      pushEdits();
    });
    on.appendChild(cb);

    const num = document.createElement('td');
    num.className = 'col-num';
    num.innerHTML = `<span class="drag-handle">⠿</span>${ch.number === null ? '—' : String(ch.number).padStart(3, '0')}`;

    const title = document.createElement('td');
    title.className = 'col-title';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = ch.title || '';
    input.placeholder = ch.sourceName;
    input.title = ch.sourceName;
    input.addEventListener('change', () => {
      ch.title = input.value;
      pushEdits();
    });
    title.appendChild(input);

    const kind = document.createElement('td');
    kind.className = 'col-kind';
    const tag = document.createElement('span');
    tag.className = `kind-tag${ch.kind === 'chapter' ? '' : ' special'}`;
    tag.textContent = KIND_LABEL[ch.kind] || ch.kind;
    kind.appendChild(tag);

    const words = document.createElement('td');
    words.className = 'col-num2';
    words.textContent = ch.words ? fmt(ch.words) : '—';

    const imgs = document.createElement('td');
    imgs.className = 'col-num2';
    imgs.textContent = ch.images || '—';

    const blocks = document.createElement('td');
    blocks.className = 'col-num2';
    blocks.textContent = ch.systemBlocks || '—';

    const issues = document.createElement('td');
    issues.className = 'col-issues';
    for (const text of ch.issues) {
      const span = document.createElement('span');
      span.className = issueClass(text);
      span.textContent = text;
      issues.appendChild(span);
    }

    tr.append(on, num, title, kind, words, imgs, blocks, issues);
    tbody.appendChild(tr);
  }

  attachDragReorder(tbody);
}

/** Перетаскивание строк меняет порядок чтения. */
function attachDragReorder(tbody) {
  let dragId = null;

  tbody.addEventListener('dragstart', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    dragId = tr.dataset.id;
    tr.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  tbody.addEventListener('dragend', (e) => {
    const tr = e.target.closest('tr');
    if (tr) tr.classList.remove('dragging');
    dragId = null;
  });

  tbody.addEventListener('dragover', (e) => {
    if (!dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  });

  tbody.addEventListener('drop', (e) => {
    if (!dragId) return;
    e.preventDefault();
    const target = e.target.closest('tr[data-id]');
    if (!target || target.dataset.id === dragId) return;

    const list = state.chapters;
    const from = list.findIndex((c) => c.id === dragId);
    const to = list.findIndex((c) => c.id === target.dataset.id);
    if (from < 0 || to < 0) return;
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);
    state.order = list.map((c) => c.id);
    renderChapters();
    pushEdits();
  });
}

let editTimer = null;
function pushEdits() {
  clearTimeout(editTimer);
  editTimer = setTimeout(async () => {
    try {
      const result = await api.applyEdits({
        chapters: state.chapters.map((c) => ({
          id: c.id,
          include: c.include,
          title: c.title,
          number: c.number,
          kind: c.kind,
        })),
        order: state.order,
        cover: state.cover,
      });
      state.stats = result.stats;
      // Пересчитанные показатели глав возвращаются из ядра.
      const byId = new Map(result.summary.chapters.map((c) => [c.id, c]));
      for (const ch of state.chapters) {
        const fresh = byId.get(ch.id);
        if (fresh) Object.assign(ch, { words: fresh.words, images: fresh.images, systemBlocks: fresh.systemBlocks });
      }
      $('tabChaptersCount').textContent = String(state.chapters.filter((c) => c.include).length);
      $('buildBtn').disabled = state.busy || !state.chapters.some((c) => c.include);
      updateOutNameHint();
      renderAudit();
    } catch (e) {
      log(`ОШИБКА применения правок: ${e.message}`);
    }
  }, 180);
}

/* ───────────────────────────── аудит ───────────────────────────── */

function stat(k, v, small) {
  return `<div class="stat"><div class="k">${k}</div><div class="v${small ? ' small' : ''}">${v}</div></div>`;
}

function renderAudit() {
  const a = state.audit;
  const s = state.stats;
  const el = $('auditContent');
  if (!a) {
    el.innerHTML = '<p class="muted">Аудит выполняется автоматически после добавления исходников.</p>';
    return;
  }

  $('tabAuditCount').textContent = String(a.gaps.length + a.duplicates.length + a.empty.length + a.broken.length);

  const parts = [];

  parts.push('<h3>Состав книги</h3><div class="stat-grid">');
  parts.push(stat('Файлов разобрано', fmt(a.total)));
  parts.push(stat('Входит в книгу', fmt(a.included)));
  parts.push(stat('Глав', fmt(a.chapters)));
  parts.push(stat('Доп. разделов', fmt(a.extras.length)));
  parts.push(
    stat('Нумерация', a.firstNumber === null ? '—' : `${String(a.firstNumber).padStart(3, '0')}–${String(a.lastNumber).padStart(3, '0')}`, true),
  );
  parts.push(stat('Иллюстраций', fmt(a.images.total)));
  parts.push('</div>');

  parts.push('<h3>Статистика текста</h3><div class="stat-grid">');
  parts.push(stat('Слов основного текста', fmt(s.words)));
  parts.push(stat('Слов с заголовками', fmt(s.wordsWithHeadings)));
  parts.push(stat('Символов с пробелами', fmt(s.charsWithSpaces)));
  parts.push(stat('Символов без пробелов', fmt(s.charsNoSpaces)));
  parts.push(stat('Среднее слов на главу', fmt(s.avgWordsPerChapter)));
  parts.push(stat('Системных блоков', fmt(s.systemBlocks)));
  parts.push('</div>');

  const problems = [];
  if (a.gaps.length) {
    problems.push(
      `<h3>Пропуски в нумерации (${a.gaps.length})</h3><ul class="note-list"><li>${a.gaps
        .map((n) => String(n).padStart(3, '0'))
        .join(', ')}</li></ul>`,
    );
  }
  if (a.duplicates.length) {
    problems.push(
      `<h3>Дубли и версии (${a.duplicates.length})</h3><ul class="note-list">${a.duplicates
        .map(
          (d) =>
            `<li><b>${d.label}</b> — ${d.identical ? 'точный дубль' : 'разные версии'}; оставлен «${d.kept}», исключено: ${d.dropped
              .map((x) => `${x.file} (${fmt(x.words)} слов)`)
              .join(', ')}</li>`,
        )
        .join('')}</ul>`,
    );
  }
  if (a.empty.length) {
    problems.push(
      `<h3>Пустые файлы (${a.empty.length})</h3><ul class="note-list">${a.empty
        .map((e) => `<li>${e.file}</li>`)
        .join('')}</ul>`,
    );
  }
  if (a.broken.length) {
    problems.push(
      `<h3>Не разобраны (${a.broken.length})</h3><ul class="note-list">${a.broken
        .map((e) => `<li>${e.file} — ${e.reason}</li>`)
        .join('')}</ul>`,
    );
  }
  if (a.shortSuspects.length) {
    problems.push(
      `<h3>Подозрительно короткие (${a.shortSuspects.length})</h3><ul class="note-list">${a.shortSuspects
        .map((e) => `<li>${e.label} — ${fmt(e.words)} слов при медиане ${fmt(e.median)}</li>`)
        .join('')}</ul>`,
    );
  }
  if (Object.keys(a.encodings).length) {
    problems.push(
      `<h3>Кодировки TXT</h3><ul class="note-list">${Object.entries(a.encodings)
        .map(([enc, n]) => `<li>${enc} — ${n} ${plural(n, 'файл', 'файла', 'файлов')}</li>`)
        .join('')}</ul>`,
    );
  }

  parts.push(
    problems.length
      ? problems.join('')
      : '<h3>Замечания</h3><p class="muted">Дублей, пропусков и повреждённых файлов не найдено.</p>',
  );

  el.innerHTML = parts.join('');
}

/* ───────────────────────────── обложка ───────────────────────────── */

function renderCoverOptions() {
  const select = $('coverSelect');
  select.innerHTML = '<option value="">— не выбрана —</option>';
  for (const c of state.coverCandidates) {
    const opt = document.createElement('option');
    opt.value = c.assetId;
    opt.textContent = `${c.name} — ${c.source}`;
    select.appendChild(opt);
  }
  if (state.cover) select.value = state.cover;
}

async function refreshCoverPreview() {
  const box = $('coverPreview');
  box.innerHTML = '';
  if (!state.cover) {
    state.coverDataUrl = null;
    box.innerHTML = '<span>нет обложки</span>';
    return;
  }
  const dataUrl = await api.assetDataUrl(state.cover);
  state.coverDataUrl = dataUrl;
  if (!dataUrl) {
    box.innerHTML = '<span>не удалось показать</span>';
    return;
  }
  const img = document.createElement('img');
  img.src = dataUrl;
  img.alt = 'Обложка';
  box.appendChild(img);
}

async function applyAccentFromCover(silent) {
  if (!state.coverDataUrl) {
    if (!silent) log('Обложка не выбрана — акцент из неё взять нельзя');
    return;
  }
  try {
    const hex = await accentFromImage(state.coverDataUrl);
    if (hex) {
      $('styleAccent').value = hex;
      $('styleAccent').dispatchEvent(new Event('input'));
      log(`Акцентный цвет из обложки: ${hex}`);
    } else if (!silent) {
      log('В обложке не нашлось спокойного цвета — оставлен текущий акцент');
    }
  } catch (e) {
    log(`Не удалось разобрать обложку: ${e.message}`);
  }
}

/* ───────────────────────────── стиль ───────────────────────────── */

function collectStyle() {
  const side = Number($('styleSide').value);
  return {
    genre: $('styleGenre').value,
    accent: $('styleAccent').value.toUpperCase(),
    serif: $('styleSerif').value,
    sans: $('styleSans').value,
    bodySize: Number($('styleBody').value),
    lineHeight: Number($('styleLead').value),
    marginLeftMm: side,
    marginRightMm: side,
    systemSize: Number($('styleSys').value),
    justify: $('styleJustify').checked,
    hyphenate: $('styleHyphen').checked,
    signature: $('styleSignature').checked,
    widowControl: $('styleWidow').checked,
    coverFit: $('coverFit').checked ? 'cover' : undefined,
  };
}

function bindSlider(id, outId, format) {
  const input = $(id);
  const out = $(outId);
  const update = () => {
    out.textContent = format(input.value);
  };
  input.addEventListener('input', update);
  update();
}

/* ───────────────────────────── сборка ───────────────────────────── */

function updateOutNameHint() {
  const title = $('metaTitle').value.trim() || 'Книга';
  const nums = state.chapters
    .filter((c) => c.include && c.kind === 'chapter' && c.number !== null)
    .map((c) => c.number)
    .sort((a, b) => a - b);
  const base = title.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_');
  const name = nums.length
    ? `${base}_главы_${String(nums[0]).padStart(3, '0')}-${String(nums[nums.length - 1]).padStart(3, '0')}`
    : `${base}_полное_издание`;
  $('outNameHint').textContent = `Файлы: ${name}.pdf · ${name}.epub`;
}

async function runBuild() {
  if (!state.outDir) {
    const dir = await api.pickOutDir();
    if (!dir) return;
    state.outDir = dir;
    $('outDirLabel').textContent = dir;
  }
  if (!$('metaTitle').value.trim()) {
    setStatus('Впишите название книги');
    $('metaTitle').focus();
    return;
  }

  setBusy(true, 'Сборка…');
  forgetDocument();
  const started = Date.now();
  log('Сборка начата');

  try {
    const report = await api.build({
      meta: {
        title: $('metaTitle').value.trim(),
        subtitle: $('metaSubtitle').value.trim(),
        team: $('metaTeam').value.trim(),
        teamUrl: $('metaUrl').value.trim(),
      },
      style: collectStyle(),
      outDir: state.outDir,
      formats: { pdf: $('fmtPdf').checked, epub: $('fmtEpub').checked },
    });

    state.report = report;
    renderReport(report);
    switchTab('report');

    const secs = ((Date.now() - started) / 1000).toFixed(1);
    setStatus(`Готово за ${secs} с · ${report.pdf ? `${fmt(report.pdf.pages)} страниц PDF` : 'EPUB собран'}`);
    log(`Готово за ${secs} с`);

    if (report.pdf) {
      $('previewRefresh').disabled = false;
      await showPreview();
    }
  } catch (e) {
    log(`ОШИБКА сборки: ${e.message}`);
    setStatus(`Ошибка сборки: ${e.message}`);
  } finally {
    setBusy(false);
  }
}

/* ───────────────────────────── отчёт ───────────────────────────── */

function checkList(qa) {
  if (!qa) return '';
  const items = qa.checks
    .map(
      (c) =>
        `<li><span class="sign ${c.ok ? 'ok' : 'bad'}">${c.ok ? '✓' : '✗'}</span>` +
        `<span>${c.name}${c.detail ? `<span class="detail"> — ${c.detail}</span>` : ''}</span></li>`,
    )
    .join('');
  const notes = (qa.notes || [])
    .map((n) => `<li><span class="sign">·</span><span class="detail">${n}</span></li>`)
    .join('');
  return `<ul class="check-list">${items}${notes}</ul>`;
}

function renderReport(report) {
  const el = $('reportContent');
  const s = report.stats;
  const parts = [];

  const first = state.chapters.find((c) => c.include && c.number !== null);
  const last = [...state.chapters].reverse().find((c) => c.include && c.number !== null);
  const range =
    first && last ? `Собраны главы ${String(first.number).padStart(3, '0')}–${String(last.number).padStart(3, '0')}.` : 'Книга собрана.';
  parts.push(`<h3>Готово</h3><p>${range}</p>`);

  for (const [kind, data] of [['PDF', report.pdf], ['EPUB', report.epub]]) {
    if (!data) continue;
    const meta =
      kind === 'PDF'
        ? `${fmt(data.pages)} страниц · оглавление ${data.tocPages} стр. · закладок ${data.bookmarks} · ${bytes(data.size)}`
        : `${fmt(data.documents)} документов · иллюстраций ${data.images} · ${bytes(data.size)}`;
    parts.push(
      `<div class="file-out"><div><div class="name">${data.path.split(/[\\/]/).pop()}</div>` +
        `<div class="meta">${meta}</div></div><div class="actions">` +
        `<button data-open="${encodeURIComponent(data.path)}" class="ghost small">Открыть</button>` +
        `<button data-reveal="${encodeURIComponent(data.path)}" class="ghost small">Показать в папке</button>` +
        '</div></div>',
    );
  }

  parts.push('<h3>Книга в цифрах</h3><div class="stat-grid">');
  parts.push(stat('Глав', fmt(s.chapters)));
  if (report.pdf) parts.push(stat('Страниц PDF', fmt(report.pdf.pages)));
  parts.push(stat('Формат PDF', report.style.pageFormat, true));
  parts.push(stat('Иллюстраций', fmt(s.images)));
  parts.push(stat('Слов основного текста', fmt(s.words)));
  parts.push(stat('Слов с заголовками', fmt(s.wordsWithHeadings)));
  parts.push(stat('Символов с пробелами', fmt(s.charsWithSpaces)));
  parts.push(stat('Символов без пробелов', fmt(s.charsNoSpaces)));
  parts.push(stat('Среднее слов на главу', fmt(s.avgWordsPerChapter)));
  parts.push('</div>');

  parts.push('<h3>Оформление</h3><div class="stat-grid">');
  parts.push(stat('Жанр', report.style.genreName, true));
  parts.push(stat('Основной шрифт', report.style.serif, true));
  parts.push(stat('Служебный шрифт', report.style.sans, true));
  parts.push(stat('Кегль', `${report.style.bodySize} pt`, true));
  parts.push(stat('Интерлиньяж', report.style.lineHeight, true));
  parts.push(
    stat('Акцент', `<span style="display:inline-block;width:11px;height:11px;border-radius:3px;background:${report.style.accent};vertical-align:middle"></span> ${report.style.accent}`, true),
  );
  parts.push(stat('Жанровые орнаменты', report.style.signature ? 'да' : 'нет', true));
  parts.push('</div>');

  if (report.qa.pdf) parts.push(`<h3>PDF — структурная проверка</h3>${checkList(report.qa.pdf)}`);
  if (report.qa.epub) parts.push(`<h3>EPUB — структурная проверка</h3>${checkList(report.qa.epub)}`);

  const warn = [
    ...(report.fontWarnings || []),
    ...((report.pdf && report.pdf.warnings) || []),
    ...((report.epub && report.epub.warnings) || []),
  ];
  if (warn.length) {
    parts.push(`<h3>Предупреждения</h3><ul class="note-list">${warn.map((w) => `<li>${w}</li>`).join('')}</ul>`);
  }

  el.innerHTML = parts.join('');

  el.querySelectorAll('[data-open]').forEach((b) =>
    b.addEventListener('click', () => api.openFile(decodeURIComponent(b.dataset.open))),
  );
  el.querySelectorAll('[data-reveal]').forEach((b) =>
    b.addEventListener('click', () => api.reveal(decodeURIComponent(b.dataset.reveal))),
  );
}

/* ───────────────────────────── предпросмотр ───────────────────────────── */

async function showPreview() {
  const grid = $('previewGrid');
  const report = state.report;
  if (!report || !report.pdf || !report.qa.pdf) {
    grid.innerHTML = '<p class="muted">Предпросмотр появится после сборки PDF.</p>';
    return;
  }

  grid.innerHTML = '<p class="muted">Отрисовка страниц…</p>';
  const sample = report.qa.pdf.visualSample || [];
  if (!sample.length) {
    grid.innerHTML = '<p class="muted">Нечего показать.</p>';
    return;
  }

  try {
    const width = Number($('previewWidth').value);
    const pages = await renderSample(report.pdf.path, sample, width);
    grid.innerHTML = '';
    for (const p of pages) {
      const fig = document.createElement('figure');
      fig.className = 'preview-item';
      const img = document.createElement('img');
      img.src = p.dataUrl;
      img.alt = `Страница ${p.page}`;
      img.style.width = `${width * 0.74}px`;
      const cap = document.createElement('figcaption');
      cap.textContent = `Стр. ${p.page} — ${p.why}`;
      fig.append(img, cap);
      grid.appendChild(fig);
    }
    log(`Предпросмотр: ${pages.length} ${plural(pages.length, 'страница', 'страницы', 'страниц')} при ширине ${width} px`);
  } catch (e) {
    grid.innerHTML = `<p class="muted">Не удалось отрисовать: ${e.message}</p>`;
    log(`ОШИБКА предпросмотра: ${e.message}`);
  }
}

/* ───────────────────────────── вкладки ───────────────────────────── */

function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === name));
}

/* ───────────────────────────── инициализация ───────────────────────────── */

async function init() {
  const defaults = await api.styleDefaults();
  for (const genre of defaults.genres) {
    const option = document.createElement('option');
    option.value = genre.id;
    option.textContent = genre.name;
    $('styleGenre').appendChild(option);
  }
  const updateGenrePreview = (resetColor = false) => {
    const genre = defaults.genres.find(g => g.id === $('styleGenre').value) || defaults.genres[0];
    if (resetColor) $('styleAccent').value = genre.accent;
    const accent = $('styleAccent').value;
    $('genreDescription').textContent = genre.description;
    $('genreOpener').innerHTML = $('styleSignature').checked ? genre.opener : '';
    $('genreDivider').innerHTML = genre.divider;
    $('genrePreview').style.setProperty('--genre-accent', accent);
    $('genrePreview').style.setProperty('--genre-bg', genre.systemBg);
    $('genreNote').style.borderRadius = genre.panel === 'rounded' ? '6px' : '0';
    document.querySelectorAll('#genrePreview svg path').forEach(p => {
      p.setAttribute('stroke', accent);
      if (p.getAttribute('fill') !== 'none') p.setAttribute('fill', accent);
    });
  };
  $('styleGenre').addEventListener('change', () => updateGenrePreview(true));
  $('styleAccent').addEventListener('input', () => updateGenrePreview());
  $('styleSignature').addEventListener('change', () => updateGenrePreview());
  updateGenrePreview(true);

  for (const [selectId, list] of [['styleSerif', defaults.families.serif], ['styleSans', defaults.families.sans]]) {
    const select = $(selectId);
    for (const name of list) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      select.appendChild(opt);
    }
  }
  for (const w of defaults.warnings) log(`! ${w}`);

  bindSlider('styleBody', 'outBody', (v) => `${Number(v).toFixed(1)} pt`);
  bindSlider('styleLead', 'outLead', (v) => Number(v).toFixed(2));
  bindSlider('styleSide', 'outSide', (v) => `${Number(v)} мм`);
  bindSlider('styleSys', 'outSys', (v) => `${Number(v).toFixed(1)} pt`);

  $('pickFilesBtn').addEventListener('click', async () => addSources(await api.pickSources()));
  $('pickFolderBtn').addEventListener('click', async () => addSources(await api.pickFolder()));
  $('clearBtn').addEventListener('click', () => {
    state.sources = [];
    state.chapters = [];
    state.audit = null;
    state.stats = null;
    state.cover = null;
    state.coverCandidates = [];
    renderSourceList();
    renderChapters();
    renderAudit();
    renderCoverOptions();
    refreshCoverPreview();
    setStatus('Добавьте главы, чтобы начать');
    $('buildBtn').disabled = true;
  });

  $('pickOutBtn').addEventListener('click', async () => {
    const dir = await api.pickOutDir();
    if (dir) {
      state.outDir = dir;
      $('outDirLabel').textContent = dir;
    }
  });

  $('pickCoverBtn').addEventListener('click', async () => {
    const file = await api.pickCover();
    if (!file) return;
    await addSources([file]);
    // Файл обложки попадает в ресурсы при разборе — выбираем его в списке.
    const found = state.coverCandidates.find((c) => c.path === file || c.name === file.split(/[\\/]/).pop());
    if (found) {
      state.cover = found.assetId;
      $('coverSelect').value = found.assetId;
      await refreshCoverPreview();
      await applyAccentFromCover(true);
      pushEdits();
    }
  });

  $('coverSelect').addEventListener('change', async (e) => {
    state.cover = e.target.value || null;
    await refreshCoverPreview();
    if (state.cover) await applyAccentFromCover(true);
    pushEdits();
  });

  $('accentAutoBtn').addEventListener('click', () => applyAccentFromCover(false));
  $('buildBtn').addEventListener('click', runBuild);
  $('chapterFilter').addEventListener('input', renderChapters);
  $('onlyProblems').addEventListener('change', renderChapters);
  $('metaTitle').addEventListener('input', updateOutNameHint);

  $('includeAllBtn').addEventListener('click', () => {
    for (const ch of state.chapters) if (ch.blocks > 0) ch.include = true;
    renderChapters();
    pushEdits();
  });

  $('excludeAllBtn').addEventListener('click', () => {
    if (!state.chapters.length) return;
    for (const ch of state.chapters) ch.include = false;
    renderChapters();
    $('buildBtn').disabled = true;
    pushEdits();
  });

  $('resortBtn').addEventListener('click', async () => {
    state.order = [];
    const result = await api.applyEdits({
      chapters: state.chapters.map((c) => ({ id: c.id, include: c.include, title: c.title })),
      order: [],
      cover: state.cover,
    });
    state.chapters = result.summary.chapters;
    state.order = state.chapters.map((c) => c.id);
    state.stats = result.stats;
    renderChapters();
    renderAudit();
  });

  $('previewRefresh').addEventListener('click', showPreview);
  $('previewWidth').addEventListener('change', showPreview);

  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));

  /* перетаскивание файлов */
  const zone = $('dropZone');
  const over = (on) => (e) => {
    e.preventDefault();
    zone.classList.toggle('over', on);
  };
  for (const el of [zone, document.body]) {
    el.addEventListener('dragover', over(true));
    el.addEventListener('dragleave', over(false));
  }
  document.body.addEventListener('drop', async (e) => {
    e.preventDefault();
    zone.classList.remove('over');
    const paths = [...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean);
    if (paths.length) await addSources(paths);
  });

  api.onProgress((p) => {
    if (p.total) {
      $('progressFill').style.width = `${Math.round((p.done / p.total) * 100)}%`;
    }
    if (p.label) setStatus(p.label);
  });

  updateOutNameHint();
  log('PDFMaker Mobile готов к работе');
}

init();

/* Хук для автоматической проверки интерфейса (scripts/smoke.js).
   Боевой код им не пользуется. */
window.__pdfmaker = { state, addSources, runBuild, showPreview, switchTab, renderChapters };

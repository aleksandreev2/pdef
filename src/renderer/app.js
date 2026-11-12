import { accentFromImage } from './accent.js';
import { renderSample, forgetDocument, renderFrontMatter } from './pdf-preview.js';
import { initUpdates } from './updates-ui.js';
import { createChapterRows } from './chapter-rows.mjs';

const api = window.api;
const $ = (id) => document.getElementById(id);
const OUTPUT_FORMATS = ['pdf','epub','fb2','mobi','azw3','txt'];
const formatInput = key => $('fmt'+key[0].toUpperCase()+key.slice(1));
const selectedFormats = () => Object.fromEntries(OUTPUT_FORMATS.map(key=>[key,formatInput(key).checked]));
const hasFormat = () => OUTPUT_FORMATS.some(key=>formatInput(key).checked);
const bookVersions = report => report.versions || [report];
const versionLabel = report => report.illustrations?.version === 'without' ? 'Без иллюстраций' : 'С иллюстрациями';

/* ───────────────────────────── состояние ───────────────────────────── */

const state = {
  sources: [],
  chapters: [],
  audit: null,
  sourceWarnings: [],
  stats: null,
  coverCandidates: [],
  cover: null,
  coverChoice: undefined,
  coverDataUrl: null,
  outDir: null,
  report: null,
  busy: false,
  order: [],
  sortByNumber: false,
};
const chapterEdits = new Map();
const pendingChapterEdits = new Map();
let editRevision = 0;
let scheduleLayoutPreview = () => {};

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

const escapeHtml = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function fillWarningList(element, warnings) {
  element.replaceChildren(...warnings.map(text => {
    const item = document.createElement('li');
    item.textContent = text;
    return item;
  }));
}

function renderSourceWarnings() {
  $('sourceWarnings').hidden = !state.sourceWarnings.length;
  fillWarningList($('sourceWarningsList'), state.sourceWarnings);
}

function reviewSourceWarnings() {
  if (!state.sourceWarnings.length) return Promise.resolve(true);
  const dialog = $('buildWarningsDialog');
  fillWarningList($('buildWarningsList'), state.sourceWarnings);
  dialog.returnValue = 'cancel';
  return new Promise(resolve => {
    dialog.addEventListener('close', () => {
      const proceed = dialog.returnValue === 'continue';
      if (!proceed) switchTab('chapters');
      resolve(proceed);
    }, { once: true });
    dialog.showModal();
  });
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
  $('chapterBody').inert = busy;
  $('chapterTools').inert = busy;
  $('coverSelect').disabled = busy;
  $('pickCoverBtn').disabled = busy;
  $('buildBtn').disabled = busy || !state.chapters.some((c) => c.include) || !hasFormat();
  OUTPUT_FORMATS.forEach(key=>{formatInput(key).disabled=busy;});
  $('fb2Compatibility').disabled = busy;
  ['illustrationVersion','illustrationCompression','illustrationKeepCover'].forEach(id=>{$(id).disabled=busy;});
  $('pickFilesBtn').disabled = busy;
  $('pickFolderBtn').disabled = busy;
  $('clearBtn').disabled = busy || !state.sources.length;
  $('progressBar').hidden = !busy;
  if (!busy) $('progressFill').style.width = '0%';
  if (label) setStatus(label);
}

/* ───────────────────────────── источники ───────────────────────────── */

async function addSources(paths) {
  if (state.busy) return;
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
  clearTimeout(editTimer);
  editRevision += 1;
  const previousIds = new Map(state.chapters.map(ch => [ch.id, ch.sourceKey]));
  const previousOrder = state.order.map(id => previousIds.get(id));
  setBusy(true, 'Разбор исходников…');
  log(`Разбор: ${state.sources.length} ${plural(state.sources.length, 'источник', 'источника', 'источников')}`);
  try {
    const imported = await api.analyze(state.sources);
    const newIds = new Map(imported.summary.chapters.map(ch => [ch.sourceKey, ch.id]));
    state.order = previousOrder.map(key => newIds.get(key)).filter(Boolean);
    const patches = imported.summary.chapters.filter(ch => chapterEdits.has(ch.sourceKey))
      .map(ch => ({ id: ch.id, ...chapterEdits.get(ch.sourceKey) }));
    const automaticCover = imported.cover?.assetId ?? null;
    const rememberedCover = imported.coverCandidates.find(c => c.hash === state.coverChoice);
    const cover = state.coverChoice === null ? null : rememberedCover?.assetId ?? automaticCover;
    const result = patches.length || state.order.length || state.sortByNumber || cover !== automaticCover
      ? await api.applyEdits({ chapters: patches, order: state.order, sortByNumber: state.sortByNumber, cover, compact: true })
      : imported;
    if (imported.suggestedTitle && !$('metaTitle').value.trim()) $('metaTitle').value = imported.suggestedTitle;
    state.chapters = result.summary.chapters;
    state.audit = result.audit;
    state.sourceWarnings = result.sourceWarnings || [];
    state.stats = result.stats;
    state.coverCandidates = imported.coverCandidates;
    state.cover = cover;
    pendingChapterEdits.clear();

    renderChapters();
    renderAudit();
    renderSourceWarnings();
    renderCoverOptions();
    await refreshCoverPreview();
    // Акцент берётся из обложки сразу: один спокойный цвет на всю книгу.
    if (state.cover) await applyAccentFromCover(true);
    scheduleLayoutPreview();
    updateOutNameHint();

    const a = result.audit;
    setStatus(
      `${a.included} ${plural(a.included, 'раздел', 'раздела', 'разделов')} · ${fmt(result.stats.words)} слов` +
        (a.gaps.length ? ` · пропусков: ${a.gaps.length}` : '') +
        (a.empty.length ? ` · пустых файлов: ${a.empty.length}` : '') +
        (a.duplicates.length ? ` · дублей: ${a.duplicates.length}` : ''),
    );
    log(`Разобрано: ${a.total}, в книгу входит ${a.included}, слов ${fmt(result.stats.words)}`);
    for (const w of imported.warnings) log(`! ${w}`);
    for (const w of state.sourceWarnings) log(`! ${w}`);
    for (const w of imported.fonts) log(`! ${w}`);
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

function rememberChapterEdit(chapter, patch) {
  Object.assign(chapter, patch);
  chapterEdits.set(chapter.sourceKey, { ...chapterEdits.get(chapter.sourceKey), ...patch });
  pendingChapterEdits.set(chapter.id, { ...pendingChapterEdits.get(chapter.id), ...patch });
}

function chapterTextField(field, chapter, label, value, save) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = `chapter-${field}`;
  input.dataset.field = field;
  input.value = value;
  input.setAttribute('aria-label', `${label} — ${chapter.sourceName}`);
  input.addEventListener('change', () => save(input));
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') input.blur();
    if (event.key === 'Escape') {
      input.value = field === 'number' ? chapter.number ?? '' : chapter.title;
      input.blur();
    }
  });
  return input;
}

function createChapterRow(ch) {
  const tr = document.createElement('tr');
  tr.dataset.id = ch.id;
  if (!ch.include) tr.classList.add('off');

  const on = document.createElement('td');
  on.className = 'col-on';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.dataset.field = 'include';
  cb.checked = ch.include;
  cb.disabled = !ch.blocks;
  cb.title = ch.blocks ? 'Включить раздел в книгу' : 'В разделе нет содержимого для экспорта';
  cb.setAttribute('aria-label', `Включить раздел — ${ch.sourceName}`);
  cb.addEventListener('change', () => {
    rememberChapterEdit(ch, { include: cb.checked });
    tr.classList.toggle('off', !cb.checked);
    pushEdits();
  });
  on.appendChild(cb);

  const num = document.createElement('td');
  num.className = 'col-num';
  const handle = document.createElement('span');
  handle.className = 'drag-handle';
  handle.draggable = true;
  handle.title = 'Перетащить раздел';
  handle.textContent = '⠿';
  const number = chapterTextField('number', ch, 'Номер главы', ch.number === null ? '' : String(ch.number), field => {
    const value = field.value.trim();
    if (value && !/^\d{1,4}$/.test(value)) {
      field.value = ch.number ?? '';
      setStatus('Введите целый номер от 0 до 9999');
      return;
    }
    rememberChapterEdit(ch, { number: value ? Number(value) : null });
    pushEdits();
  });
  number.inputMode = 'numeric';
  number.maxLength = 4;
  number.placeholder = '—';
  number.disabled = ch.kind !== 'chapter' || !ch.blocks;
  const numberGroup = document.createElement('div');
  numberGroup.className = 'chapter-number-group';
  numberGroup.append(handle, number);
  num.appendChild(numberGroup);

  const title = document.createElement('td');
  title.className = 'col-title';
  const input = chapterTextField('title', ch, 'Название главы', ch.title, field => {
    rememberChapterEdit(ch, { title: field.value.trim() });
    pushEdits();
  });
  input.placeholder = 'Без названия';
  input.disabled = !ch.blocks;
  const source = document.createElement('small');
  source.className = 'chapter-source';
  source.textContent = ch.sourceName;
  source.title = ch.sourcePath || ch.sourceName;
  title.append(input, source);

  const kind = document.createElement('td');
  kind.className = 'col-kind';
  const type = document.createElement('select');
  type.className = 'chapter-kind';
  type.dataset.field = 'kind';
  type.setAttribute('aria-label', `Тип раздела — ${ch.sourceName}`);
  for (const [value, label] of Object.entries(KIND_LABEL)) type.add(new Option(label, value));
  type.value = ch.kind;
  type.disabled = !ch.blocks;
  type.addEventListener('change', () => {
    const value = type.value;
    rememberChapterEdit(ch, value === 'chapter' ? { kind: value } : { kind: value, number: null });
    number.disabled = value !== 'chapter';
    number.value = ch.number ?? '';
    pushEdits();
  });
  kind.appendChild(type);

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
  return tr;
}

const chapterRows = createChapterRows($('chapterBody'), createChapterRow, ch => JSON.stringify([
  ch.include, ch.blocks, ch.number, ch.title, ch.kind, ch.sourceName, ch.sourcePath,
  ch.words, ch.images, ch.systemBlocks, ch.issues,
]));

function renderChapters() {
  const tbody = $('chapterBody');
  const focus = document.activeElement;
  const focusId = focus?.closest('#chapterBody tr[data-id]')?.dataset.id;
  const focusField = focusId && focus.dataset.field;
  const selection = focusField && focus.type === 'text' ? [focus.selectionStart, focus.selectionEnd] : null;
  const draftValue = focus?.value;
  const visible = visibleChapters();
  chapterRows.render(state.chapters, visible);
  $('tabChaptersCount').textContent = String(state.chapters.filter((c) => c.include).length);

  if (!visible.length) {
    const tr = document.createElement('tr');
    tr.className = 'empty';
    tr.innerHTML = '<td colspan="8">Ничего не найдено</td>';
    tbody.appendChild(tr);
    return;
  }

  if (!focusField || document.activeElement === focus) return;
  const nextRow = Array.from(tbody.children).find(row => row.dataset.id === focusId);
  const nextFocus = nextRow?.querySelector(`[data-field="${focusField}"]`);
  if (nextFocus && !nextFocus.disabled) {
    nextFocus.focus({ preventScroll: true });
    if (selection) {
      nextFocus.value = draftValue;
      nextFocus.setSelectionRange(...selection);
    }
  }
}

/** Перетаскивание строк меняет порядок чтения. */
function attachDragReorder(tbody) {
  let dragId = null;

  tbody.addEventListener('dragstart', (e) => {
    if (!e.target.closest('.drag-handle')) return;
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
  editRevision += 1;
  clearTimeout(editTimer);
  editTimer = setTimeout(() => {
    syncEdits().catch(e => log(`ОШИБКА применения правок: ${e.message}`));
  }, 180);
}

async function syncEdits() {
  clearTimeout(editTimer);
  editTimer = null;
  const revision = editRevision;
  const result = await api.applyEdits({
    chapters: Array.from(pendingChapterEdits, ([id, patch]) => ({ id, ...patch })),
    order: state.order,
    sortByNumber: state.sortByNumber,
    cover: state.cover,
    compact: true,
  });
  if (revision !== editRevision) return;
  pendingChapterEdits.clear();
  const previous = new Map(state.chapters.map(ch => [ch.id, ch]));
  let labelsChanged = false;
  state.chapters = result.summary.chapters.map(chapter => {
    const existing = previous.get(chapter.id);
    if (chapter.label !== existing?.label) labelsChanged = true;
    return existing ? Object.assign(existing, chapter) : chapter;
  });
  if (labelsChanged) renderCoverOptions();
  state.stats = result.stats;
  state.audit = result.audit;
  state.sourceWarnings = result.sourceWarnings || [];
  renderChapters();
  $('buildBtn').disabled = state.busy || !state.chapters.some((c) => c.include) || !hasFormat();
  updateOutNameHint();
  renderAudit();
  renderSourceWarnings();
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
    $('tabAuditCount').textContent = '—';
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
            `<li><b>${escapeHtml(d.label)}</b> — ${d.identical ? 'точный дубль' : 'разные версии'}<ul>${d.versions
              .map((x) => `<li>${escapeHtml(x.file)} · ${fmt(x.words)} слов · ${x.include ? 'в книге' : 'исключён'}</li>`)
              .join('')}</ul></li>`,
        )
        .join('')}</ul>`,
    );
  }
  if (a.empty.length) {
    problems.push(
      `<h3>Пустые файлы (${a.empty.length})</h3><ul class="note-list">${a.empty
        .map((e) => `<li>${escapeHtml(e.file)}</li>`)
        .join('')}</ul>`,
    );
  }
  if (a.broken.length) {
    problems.push(
      `<h3>Не разобраны (${a.broken.length})</h3><ul class="note-list">${a.broken
        .map((e) => `<li>${escapeHtml(e.file)} — ${escapeHtml(e.reason)}</li>`)
        .join('')}</ul>`,
    );
  }
  if (a.shortSuspects.length) {
    problems.push(
      `<h3>Подозрительно короткие (${a.shortSuspects.length})</h3><ul class="note-list">${a.shortSuspects
        .map((e) => `<li>${escapeHtml(e.label)} — ${fmt(e.words)} слов при медиане ${fmt(e.median)}</li>`)
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
  const chapters = new Map(state.chapters.map(ch => [ch.id, ch.label]));
  const groups = [document.createElement('optgroup'), document.createElement('optgroup')];
  groups[0].label = 'Отдельные файлы и обложки';
  groups[1].label = 'Иллюстрации из глав';
  for (const c of state.coverCandidates) {
    const opt = document.createElement('option');
    opt.value = c.assetId;
    opt.textContent = c.chapterId ? `${chapters.get(c.chapterId) ?? c.source} — ${c.name}` : c.name;
    opt.title = c.sourcePath || '';
    groups[c.chapterId ? 1 : 0].appendChild(opt);
  }
  for (const group of groups) if (group.childElementCount) select.appendChild(group);
  if (state.cover) select.value = state.cover;
}

async function chooseCover(candidate) {
  state.cover = candidate?.assetId ?? null;
  state.coverChoice = candidate?.hash ?? null;
  $('coverSelect').value = state.cover ?? '';
  pushEdits();
  if (await refreshCoverPreview()) await applyAccentFromCover(true);
}

let coverPreviewRevision = 0;
async function refreshCoverPreview() {
  const box = $('coverPreview');
  const revision = ++coverPreviewRevision;
  state.coverDataUrl = null;
  if (!state.cover) {
    box.innerHTML = '<span>нет обложки</span>';
    return false;
  }
  box.innerHTML = '<span>Загрузка…</span>';
  let dataUrl;
  try {
    dataUrl = await api.assetThumbnail(state.cover);
  } catch (error) {
    if (revision === coverPreviewRevision) log(`ОШИБКА предпросмотра обложки: ${error.message}`);
  }
  if (revision !== coverPreviewRevision) return false;
  state.coverDataUrl = dataUrl;
  if (!dataUrl) {
    box.innerHTML = '<span>не удалось показать</span>';
    return false;
  }
  const img = document.createElement('img');
  img.src = dataUrl;
  img.alt = 'Обложка';
  box.replaceChildren(img);
  return true;
}

async function applyAccentFromCover(silent) {
  const dataUrl = state.coverDataUrl;
  if (!dataUrl) {
    if (!silent) log('Обложка не выбрана — акцент из неё взять нельзя');
    return;
  }
  try {
    const hex = await accentFromImage(dataUrl);
    if (dataUrl !== state.coverDataUrl) return;
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
    ...collectManualLayout(),
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
  const selected=OUTPUT_FORMATS.filter(key=>formatInput(key).checked);
  const fb2Selected = selected.includes('fb2');
  $('fb2CompatibilityRow').hidden = !fb2Selected;
  $('fb2CompatibilityHelp').hidden = !fb2Selected || !$('fb2Compatibility').checked;
  const version = $('illustrationVersion').value;
  $('keepCoverRow').hidden = version === 'with';
  const suffixes = version === 'both' ? ['', '_без_иллюстраций'] : [version === 'without' ? '_без_иллюстраций' : ''];
  const destination = selected.length > 1 || version === 'both' ? 'В папке новеллы. ' : 'В выбранной папке. ';
  const names = suffixes.flatMap(suffix => selected.map(key => {
    const compatibility = key === 'fb2' && $('fb2Compatibility').checked ? '_для_старых_читалок' : '';
    return name + suffix + compatibility + '.' + key;
  }));
  $('outNameHint').textContent = names.length ? `${destination}Файлы: ${names.join(' · ')}` : 'Выберите хотя бы один формат';
}

async function chooseOutputDirectory() {
  try {
    const dir = await api.pickOutDir();
    if (!dir) return null;
    state.outDir = dir;
    $('outDirLabel').textContent = dir;
    $('pickOutBtn').textContent = 'Изменить папку…';
    updateOutNameHint();
    return dir;
  } catch (error) {
    log(`ОШИБКА сохранения папки: ${error.message}`);
    setStatus(`Не удалось запомнить папку: ${error.message}`);
    return null;
  }
}

async function runBuild() {
  if (state.busy) return;
  if(!hasFormat()) {setStatus('Выберите хотя бы один формат для сохранения');return;}
  if (!state.outDir) {
    if (!await chooseOutputDirectory()) return;
    if (state.busy) return;
  }
  if (!$('metaTitle').value.trim()) {
    setStatus('Впишите название книги');
    $('metaTitle').focus();
    return;
  }

  setBusy(true, 'Проверка состава книги…');
  try {
    // Flush changes before reviewing: a just-excluded chapter can create a gap.
    await syncEdits();
    if (!state.chapters.some(c => c.include)) { setStatus('Нет включённых глав для сборки'); return; }
    if (!await reviewSourceWarnings()) { setStatus('Сборка отменена. Проверьте состав глав.'); return; }
    setStatus('Сборка…');
    previewBlocked = true;
    await invalidatePreview();
    const started = Date.now();
    log('Сборка начата');
    const report = await api.build({
      meta: {
        title: $('metaTitle').value.trim(),
        subtitle: $('metaSubtitle').value.trim(),
        team: $('metaTeam').value.trim(),
        teamUrl: $('metaUrl').value.trim(),
      },
      style: collectStyle(),
      outDir: state.outDir,
      formats: selectedFormats(),
      fb2Compatibility: $('fb2Compatibility').checked,
      illustrations: {
        version: $('illustrationVersion').value,
        compression: $('illustrationCompression').value,
        keepCover: $('illustrationKeepCover').checked,
      },
    });

    state.report = report;
    $('previewVersion').innerHTML = '';
    bookVersions(report).forEach((r,i)=>{
      const option = document.createElement('option');
      option.value = i;
      option.textContent = versionLabel(r);
      $('previewVersion').appendChild(option);
    });
    $('previewVersion').hidden = !report.versions;
    renderReport(report);
    switchTab('report');

    const secs = ((Date.now() - started) / 1000).toFixed(1);
    const saved=OUTPUT_FORMATS.filter(key=>report[key]).map(key=>key.toUpperCase()).join(', ');
    setStatus(`Готово за ${secs} с · ${saved}${report.versions ? ' · обе версии' : ''}`);
    log(`Готово за ${secs} с`);
    log(`Папка экспорта: ${report.outDir}`);

    if (report.pdf) {
      $('previewRefresh').disabled = false;
    } else {
      $('previewRefresh').disabled = true;
    }
  } catch (e) {
    log(`ОШИБКА сборки: ${e.message}`);
    setStatus(`Ошибка сборки: ${e.message}`);
  } finally {
    previewBlocked = false;
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

  for (const version of bookVersions(report)) {
    parts.push(`<h3>${versionLabel(version)}</h3><p class="muted small">Иллюстраций в тексте: ${fmt(version.stats.images)}</p>`);
    const compression = version.illustrations;
    if (compression && compression.compression !== 'off') parts.push(`<p class="muted small">Сжатие: ${compression.compression === 'strong' ? 'сильное' : 'умеренное'} · сжато изображений: ${fmt(compression.compressed)} · экономия ресурсов: ${compression.savedBytes ? bytes(compression.savedBytes) : '0 КБ'}</p>`);
    for (const key of OUTPUT_FORMATS) {
      const kind=key.toUpperCase(),data=version[key];
      if (!data) continue;
      const meta =
        kind === 'PDF'
          ? `${fmt(data.pages)} страниц · оглавление ${data.tocPages} стр. · закладок ${data.bookmarks} · ${bytes(data.size)}`
          : key === 'epub' ? `${fmt(data.documents)} документов · иллюстраций ${data.images} · ${bytes(data.size)}`
          : `${fmt(data.chapters)} разделов · ${key==='txt' ? 'обычный текст · ' : `иллюстраций ${fmt(data.images)} · `}${bytes(data.size)}`;
      parts.push(
        `<div class="file-out"><div><div class="name">${data.path.split(/[\\/]/).pop()}</div>` +
          `<div class="meta">${meta}</div></div><div class="actions">` +
          `<button data-open="${encodeURIComponent(data.path)}" class="ghost small">Открыть</button>` +
          `<button data-reveal="${encodeURIComponent(data.path)}" class="ghost small">Показать в папке</button>` +
          '</div></div>',
      );
    }
  }
  parts.push(`<h3>Книга в цифрах${report.versions ? ' — ' + versionLabel(report) : ''}</h3><div class="stat-grid">`);
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

  for (const version of bookVersions(report)) {
    for (const key of OUTPUT_FORMATS) if (version.qa[key]) parts.push(`<h3>${key.toUpperCase()} — проверка${report.versions ? ' · ' + versionLabel(version) : ''}</h3>${checkList(version.qa[key])}`);
  }

  const warn = [
    ...(report.sourceWarnings || []),
    ...(report.fontWarnings || []),
    ...bookVersions(report).flatMap(version=>[
      ...(version.illustrations?.warnings || []),
      ...OUTPUT_FORMATS.flatMap(key=>version[key]?.warnings || []),
    ]),
  ];
  if (warn.length) {
    parts.push(`<h3>Предупреждения</h3><ul class="note-list">${warn.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>`);
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

let previewRevision = 0;
let previewKey = null;
let previewBlocked = false;

function invalidatePreview() {
  previewRevision++;
  previewKey = null;
  return forgetDocument();
}

async function showPreview(force = false) {
  const grid = $('previewGrid');
  if (previewBlocked) {
    grid.innerHTML = '<p class="muted">PDF собирается…</p>';
    return;
  }
  const report = state.report && bookVersions(state.report)[Number($('previewVersion').value) || 0];
  if (!report || !report.pdf || !report.qa.pdf) {
    void invalidatePreview();
    grid.innerHTML = '<p class="muted">Предпросмотр появится после сборки PDF.</p>';
    return;
  }

  const sample = report.qa.pdf.visualSample || [];
  if (!sample.length) {
    void invalidatePreview();
    grid.innerHTML = '<p class="muted">Нечего показать.</p>';
    return;
  }

  const width = Number($('previewWidth').value);
  const key = JSON.stringify([report.pdf.fileUrl, width]);
  if (!force && key === previewKey) return;
  previewKey = key;
  const revision = ++previewRevision;
  grid.innerHTML = '<p class="muted">Отрисовка страниц…</p>';
  try {
    const pages = await renderSample(report.pdf.fileUrl, sample, width);
    if (revision !== previewRevision || !pages) return;
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
    if (revision !== previewRevision) return;
    previewKey = null;
    const message = document.createElement('p');
    message.className = 'muted';
    message.textContent = `Не удалось отрисовать: ${e.message}`;
    grid.replaceChildren(message);
    log(`ОШИБКА предпросмотра: ${e.message}`);
  }
}

/* ───────────────────────────── вкладки ───────────────────────────── */

function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === name));
  if (name === 'preview') void showPreview();
}

/* ───────────────────────────── инициализация ───────────────────────────── */

async function initBookMetadata() {
  const fields = { subtitle: $('metaSubtitle'), team: $('metaTeam'), teamUrl: $('metaUrl') };
  const edited = new Set();
  for (const [key, input] of Object.entries(fields)) {
    input.addEventListener('input', () => {
      edited.add(key);
      api.saveBookMetadata({ [key]: input.value }).catch(error => log(`Не удалось сохранить сведения о книге: ${error.message}`));
    });
  }
  try {
    const saved = await api.bookMetadata();
    for (const [key, input] of Object.entries(fields)) {
      if (!edited.has(key) && typeof saved[key] === 'string') input.value = saved[key];
    }
  } catch (error) {
    log(`Не удалось прочитать сведения о книге: ${error.message}`);
  }
}

async function init() {
  await initBookMetadata();
  const defaults = await api.styleDefaults();
  initManualLayout(defaults);
  for(const [id,key] of [['styleBody','bodySize'],['styleLead','lineHeight'],['styleSide','marginLeftMm'],['styleSys','systemSize']]) {
    const input=$(id), limits=defaults.limits[key];
    input.min=limits[0]; input.max=limits[1]; input.value=defaults.style[key];
  }
  try {
    state.outDir = await api.outputDirectory();
    if (state.outDir) {
      $('outDirLabel').textContent = state.outDir;
      $('pickOutBtn').textContent = 'Изменить папку…';
    }
  } catch (error) {
    log(`Не удалось прочитать сохранённую папку: ${error.message}`);
  }
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
    const decorated = $('styleSignature').checked;
    const colorize = svg => (svg || '').replaceAll(genre.accent, accent);
    for(const [id,key] of [['genreOpener','opener'],['genreDivider','divider'],['genreFolio','folio']]) {
      $(id).innerHTML = decorated ? colorize(genre[key]) : '';
    }

    $('genrePreview').classList.toggle('plain',!decorated);
    $('genrePreview').style.setProperty('--genre-accent', accent);
    $('genrePreview').style.setProperty('--genre-bg', genre.systemBg);
    $('genrePreview').style.setProperty('--genre-border', genre.systemBorder);
    $('genreNote').style.borderRadius = genre.panel === 'rounded' ? '6px' : '0';
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
    clearTimeout(editTimer);
    editRevision += 1;
    chapterEdits.clear();
    pendingChapterEdits.clear();
    state.order = [];
    state.sortByNumber = false;
    state.sources = [];
    state.chapters = [];
    state.audit = null;
    state.sourceWarnings = [];
    state.stats = null;
    state.cover = null;
    state.coverChoice = undefined;
    state.coverCandidates = [];
    renderSourceList();
    renderChapters();
    renderAudit();
    renderSourceWarnings();
    renderCoverOptions();
    refreshCoverPreview();
    scheduleLayoutPreview();
    api.clearBook().catch(error => log(`ОШИБКА очистки книги: ${error.message}`));
    setStatus('Добавьте главы, чтобы начать');
    $('buildBtn').disabled = true;
  });

  $('pickOutBtn').addEventListener('click', chooseOutputDirectory);

  $('pickCoverBtn').addEventListener('click', async () => {
    const file = await api.pickCover();
    if (!file || state.busy) return;
    setBusy(true, 'Загрузка обложки…');
    try {
      const candidate = await api.addCover(file);
      state.coverCandidates = state.coverCandidates.filter(c => c.assetId !== candidate.assetId);
      state.coverCandidates.push(candidate);
      if (!state.sources.includes(file)) state.sources.push(file);
      renderSourceList();
      renderCoverOptions();
      await chooseCover(candidate);
      setStatus('Обложка выбрана');
    } catch (error) {
      log(`ОШИБКА загрузки обложки: ${error.message}`);
      setStatus(`Не удалось загрузить обложку: ${error.message}`);
    } finally {
      setBusy(false);
    }
  });

  $('coverSelect').addEventListener('change', async (e) => {
    await chooseCover(state.coverCandidates.find(c => c.assetId === e.target.value));
  });

  $('accentAutoBtn').addEventListener('click', () => applyAccentFromCover(false));
  $('buildBtn').addEventListener('click', runBuild);
  $('showSourceAudit').addEventListener('click', () => switchTab('audit'));
  $('chapterFilter').addEventListener('input', renderChapters);
  $('onlyProblems').addEventListener('change', renderChapters);
  attachDragReorder($('chapterBody'));
  $('metaTitle').addEventListener('input', updateOutNameHint);
  OUTPUT_FORMATS.forEach(key=>formatInput(key).addEventListener('change',()=>{
    updateOutNameHint();
    $('buildBtn').disabled=state.busy || !state.chapters.some(c=>c.include) || !hasFormat();
  }));

  $('illustrationVersion').addEventListener('change',updateOutNameHint);
  $('fb2Compatibility').addEventListener('change',updateOutNameHint);
  $('previewVersion').addEventListener('change', () => showPreview());

  $('includeAllBtn').addEventListener('click', () => {
    for (const ch of state.chapters) if (ch.blocks) rememberChapterEdit(ch, { include: true });
    renderChapters();
    pushEdits();
    scheduleLayoutPreview();
  });

  $('excludeAllBtn').addEventListener('click', () => {
    if (!state.chapters.length) return;
    for (const ch of state.chapters) if (ch.blocks) rememberChapterEdit(ch, { include: false });
    renderChapters();
    $('buildBtn').disabled = true;
    pushEdits();
    scheduleLayoutPreview();
  });

  $('resortBtn').addEventListener('click', () => {
    state.order = [];
    state.sortByNumber = true;
    pushEdits();
  });

  $('previewRefresh').addEventListener('click', () => showPreview(true));
  $('previewWidth').addEventListener('change', () => showPreview());

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
  initUpdates(api,{isBusy:()=>state.busy,setBusy:busy=>setBusy(busy,busy?'Загрузка обновления…':undefined)});
}


/* Хук для автоматической проверки интерфейса (scripts/smoke.js).
   Боевой код им не пользуется. */
window.__pdfmaker = { state, addSources, runBuild, showPreview, switchTab, renderChapters };

/* Ручное оформление первых страниц: история и настоящий PDF-образец. */
const manualFields = [
  ['titleSize','Название, pt','titleControls'],
  ['titleTopMm','Отступ сверху, мм','titleControls'],
  ['titleMarkWidthMm','Ширина орнамента, мм','titleControls'],
  ['titleGapMm','После орнамента, мм','titleControls'],
  ['subtitleSize','Подзаголовок, pt','titleControls'],
  ['creditSize','Подпись команды, pt','titleControls'],
  ['creditBottomMm','Подпись от низа поля, мм','titleControls'],
  ['aboutTopMm','Отступ сверху, мм','aboutControls'],
  ['aboutTitleSize','Название команды, pt','aboutControls'],
  ['aboutBodySize','Текст перевода, pt','aboutControls'],
  ['aboutGapMm','После разделителя, мм','aboutControls'],
];
function collectManualLayout() {
  return Object.fromEntries(manualFields.map(([key])=>[key,Number($('manual_'+key)?.value)]));
}
function initManualLayout(defaults) {
  let current={}, history=[], timer, revision=0, running=false;
  for(const [key,label,group] of manualFields) {
    const wrapper=document.createElement('label'); wrapper.textContent=label;
    const input=document.createElement('input'); input.type='number'; input.id='manual_'+key;
    [input.min,input.max]=defaults.limits[key]; input.step='0.5'; input.value=defaults.style[key];
    current[key]=defaults.style[key]; wrapper.append(input); $(group).append(wrapper);
    input.addEventListener('input',()=>{
      history.push({...current}); if(history.length>100) history.shift();
      const value=Number(input.value);
      current[key]=Math.min(Number(input.max),Math.max(Number(input.min),Number.isFinite(value)?value:defaults.style[key]));
      $('layoutUndo').disabled=false; schedule();
    });
    input.addEventListener('change',()=>{input.value=current[key];});
  }
  function restore(values) {
    current={...values};
    for(const [key] of manualFields) $('manual_'+key).value=current[key];
    $('layoutUndo').disabled=history.length===0; schedule();
  }
  $('layoutUndo').addEventListener('click',()=>{if(history.length) restore(history.pop());});
  $('layoutReset').addEventListener('click',()=>{
    history.push({...current}); restore(Object.fromEntries(manualFields.map(([key])=>[key,defaults.style[key]])));
  });
  function schedule() {
    revision++; clearTimeout(timer); timer=setTimeout(update,450);
    $('layoutPreviewStatus').textContent='Обновление образца…';
  }
  async function update() {
    if(running) return;
    running=true; const version=revision;
    try {
      const style={...defaults.style,...collectStyle()};
      const meta={title:$('metaTitle').value,subtitle:$('metaSubtitle').value,team:$('metaTeam').value,teamUrl:$('metaUrl').value};
      const selected=state.chapters.filter(c=>c.include);
      const stats={chapters:selected.filter(c=>c.kind==='chapter').length,words:selected.reduce((sum,c)=>sum+(c.words||0),0)};
      const data=await api.previewFrontMatter({meta,style,stats});
      if(version!==revision) return;
      const result=await renderFrontMatter(data,style);
      if(version!==revision) return;
      $('layoutPreview').replaceChildren();
      for(const page of result.pages) {
        const fig=document.createElement('figure'),img=document.createElement('img'),cap=document.createElement('figcaption');
        img.src=page.dataUrl; img.alt=page.label; cap.textContent=page.label;
        fig.append(img,cap); $('layoutPreview').append(fig);
      }
      $('layoutPreviewStatus').textContent=result.warnings.length?result.warnings.join(' '):'Текст в пределах полей. Перекрытий текста не обнаружено.';
    } catch(e) {
      if(version===revision) $('layoutPreviewStatus').textContent=`Не удалось обновить образец: ${e.message}`;
    } finally {
      running=false; if(version!==revision) timer=setTimeout(update,100);
    }
  }
  for(const id of ['metaTitle','metaSubtitle','metaTeam','metaUrl','styleGenre','styleAccent','styleSerif','styleSans','styleSide','styleSignature']) {
    $(id).addEventListener('input',schedule); $(id).addEventListener('change',schedule);
  }
  $('chapterBody').addEventListener('change',schedule);
  scheduleLayoutPreview=schedule;
  schedule();
}

init();

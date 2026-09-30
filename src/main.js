import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import './style.css';
import TOML from '@iarna/toml';
import Ajv2020 from 'ajv/dist/2020.js';
import schemaText from './schedule.schema.json?raw';
import teachersText from './catalogs/teachers.toml?raw';
import subjectsText from './catalogs/subjects.toml?raw';
import roomsText from './catalogs/rooms.toml?raw';

const schema = JSON.parse(schemaText);
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validate = ajv.compile(schema);
const catalogs = {
  teachers: TOML.parse(teachersText).departments,
  subjects: TOML.parse(subjectsText).grades,
  rooms: TOML.parse(roomsText).grades,
};

const STORAGE_KEY = 'knct-scd-helper-draft-v1';
const HISTORY_KEY = 'knct-scd-helper-history-v1';
const dayDefs = Object.entries(schema.properties.days.properties).sort((a, b) => a[1]['x-ui'].order - b[1]['x-ui'].order);
const dayNames = dayDefs.map(([key]) => key);
const dayLabels = dayDefs.map(([, definition]) => definition.title);
const dayMax = schema.$defs.day.maxItems;
const fieldDefs = schema.$defs.lesson.properties;
const fields = ['subject', 'teacher', 'room'];
const gradeValues = schema.properties.grade.enum;
const departments = schema.properties.department.enum;

function emptySlot() {
  return { subject: '', teacher: '', room: '', _auto: false };
}

function freshState() {
  return {
    screen: 'setup',
    grade: null,
    className: '',
    department: '',
    activeDay: 0,
    counts: Array(dayNames.length).fill(null),
    slots: Array.from({ length: dayNames.length }, () => []),
    completed: Array(dayNames.length).fill(false),
  };
}

function readState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved || !Array.isArray(saved.slots) || saved.slots.length !== dayNames.length) return freshState();
    return { ...freshState(), ...saved, screen: saved.grade ? saved.screen : 'setup' };
  } catch {
    return freshState();
  }
}

let state = readState();
let app;

function saveDraft() {
  const safe = { ...state, slots: state.slots.map((day) => day.map(({ subject, teacher, room }) => ({ subject, teacher, room }))) };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
}

function readHistory() {
  try {
    const value = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeHistory(items) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(-1200)));
}

function classOptions(grade) {
  return grade === 1 ? ['1', '2', '3'] : ['CN', 'ES', 'IT'];
}

function classDepartment(className) {
  return departments.includes(className) ? className : '';
}

function selectedCatalog(kind) {
  if (!state.grade) return [];
  if (kind === 'teachers') {
    return [...new Set([
      ...(catalogs.teachers?.DG?.teachers || []),
      ...(catalogs.teachers?.[state.department]?.teachers || []),
    ])];
  }
  const key = String(state.grade);
  const gradeCatalog = catalogs[kind]?.[key];
  if (kind === 'subjects') {
    return [...new Set([
      ...(gradeCatalog?.general_education || []),
      ...(gradeCatalog?.departments?.[state.department]?.subjects || []),
    ])];
  }
  return gradeCatalog?.[kind] || [];
}

function dataObject() {
  const days = Object.fromEntries(dayNames.map((day, dayIndex) => [
    day,
    state.slots[dayIndex].map((slot, index) => ({
      period: index + 1,
      subject: slot.subject,
      teacher: slot.teacher,
      room: slot.room,
    })),
  ]));
  return {
    schemaVersion: '1.0.0',
    grade: state.grade,
    class: state.className,
    department: state.department,
    days,
  };
}

function isComplete() {
  if (!state.grade || !state.className || !state.department || state.completed.some((done) => !done)) return false;
  return state.slots.every((day) => day.every((slot) => fields.every((field) => slot[field].trim().length > 0)));
}

function validationSummary() {
  const data = dataObject();
  const valid = validate(data);
  return { valid, errors: validate.errors || [] };
}

function icon(name, extra = '') {
  return `<i class="bi bi-${name}${extra ? ` ${extra}` : ''}" aria-hidden="true"></i>`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function setupMarkup() {
  const options = (values, selected, emptyLabel) => `<option value="">${emptyLabel}</option>${values.map((value) => `<option value="${escapeHtml(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('')}`;
  const gradeOptions = gradeValues.map((grade) => `<option value="${grade}" ${state.grade === grade ? 'selected' : ''}>${grade}年</option>`).join('');
  const classList = state.grade ? classOptions(state.grade) : [];
  const gradeOne = state.grade === 1;
  return `
    <section class="setup-card panel-card" aria-labelledby="setup-title">
      <div class="panel-heading">
        <div class="step-number">01</div>
        <div>
          <p class="eyebrow">入力対象</p>
          <h2 id="setup-title">学年・クラスを選択</h2>
        </div>
      </div>
      <p class="panel-intro">これから入力する時間割の対象を選んでください。</p>
      <div class="row g-3 setup-fields">
        <div class="col-md-4">
          <label class="form-label" for="grade">学年</label>
          <select class="form-select form-select-lg" id="grade" data-setup="grade" autofocus>
            <option value="">学年を選択</option>${gradeOptions}
          </select>
        </div>
        <div class="col-md-4">
          <label class="form-label" for="className">クラス</label>
          <select class="form-select form-select-lg" id="className" data-setup="className" ${state.grade ? '' : 'disabled'}>
            ${options(classList, state.className, 'クラスを選択')}
          </select>
        </div>
        <div class="col-md-4">
          <label class="form-label" for="department">学科</label>
          <select class="form-select form-select-lg" id="department" data-setup="department" ${!state.grade || !gradeOne || !state.className ? 'disabled' : ''}>
            ${options(departments, state.department, gradeOne ? '学科を選択' : state.className ? 'クラスから設定' : 'クラス選択後に設定')}
          </select>
          <div class="form-text">${gradeOne ? '1年生は所属学科も選択します。一般教育科の候補は全学科共通です。' : '2〜5年生はクラスから学科を設定します。一般教育科の候補も表示します。'}</div>
        </div>
      </div>
      <div class="setup-footer">
        <div class="keyboard-hint">${icon('keyboard')} Tabで移動、Enterで選択</div>
        <button class="btn btn-primary btn-lg" data-action="begin" ${state.grade && state.className && state.department ? '' : 'disabled'}>
          曜日入力へ ${icon('arrow-right')}
        </button>
      </div>
    </section>`;
}

function weekRailMarkup() {
  return `<nav class="week-rail" aria-label="曜日ごとの入力状況">
    ${dayNames.map((day, index) => {
      const status = state.completed[index] ? 'done' : index === state.activeDay && state.screen !== 'setup' && state.screen !== 'review' ? 'current' : '';
      return `<div class="week-day ${status}"><span class="week-day-index">${String(index + 1).padStart(2, '0')}</span><span class="week-day-name">${dayLabels[index]}</span>${state.completed[index] ? `<span class="week-check">${icon('check2')}</span>` : ''}</div>`;
    }).join('')}
  </nav>`;
}

function countMarkup() {
  const index = state.activeDay;
  const dayName = dayLabels[index];
  const dayKey = dayNames[index];
  const count = state.counts[index];
  const options = Array.from({ length: dayMax + 1 }, (_, number) => `<option value="${number}" ${count === number ? 'selected' : ''}>${number === 0 ? '0時限（授業なし）' : `${number}時限`}</option>`).join('');
  return `
    <section class="panel-card day-card" aria-labelledby="day-title">
      <div class="panel-heading">
        <div class="step-number">${String(index + 2).padStart(2, '0')}</div>
        <div>
          <p class="eyebrow">${escapeHtml(state.grade)}年 ${escapeHtml(state.className)}組 · ${escapeHtml(state.department)}</p>
          <h2 id="day-title">${dayName}の時限数</h2>
        </div>
      </div>
      <p class="panel-intro">${dayName}は何時限目までありますか？時限がない日は「授業なし」を選んでください。</p>
      <div class="count-picker-wrap">
        <label class="form-label" for="periodCount">時限数</label>
        <div class="count-picker">
          <select class="form-select form-select-lg" id="periodCount" data-count>
            <option value="">選択してください</option>${options}
          </select>
          <span class="count-unit">/ ${dayMax}時限</span>
        </div>
      </div>
      <div class="day-navigation">
        <button class="btn btn-outline-secondary" data-action="previous-day" ${index === 0 ? 'disabled' : ''}>${icon('arrow-left')} 前の曜日</button>
        <button class="btn btn-primary btn-lg" data-action="confirm-count" ${count === null ? 'disabled' : ''}>
          ${count === 0 ? 'この曜日を確定' : `${count || ''}時限の入力へ`} ${icon('arrow-right')}
        </button>
      </div>
      <p class="keyboard-hint">${icon('keyboard')} Tabで時限数を選択、Enterで進む</p>
      <span class="sr-only">${dayKey}</span>
    </section>`;
}

function renderLessonSlot(slot, slotIndex) {
  const period = slotIndex + 1;
  const dayIndex = state.activeDay;
  return `<article class="lesson-card">
    <div class="lesson-period"><span>${String(period).padStart(2, '0')}</span><small>時限目</small></div>
    <div class="lesson-fields">
      ${fields.map((field) => {
        const definition = fieldDefs[field];
        const listId = `options-${dayIndex}-${slotIndex}-${field}`;
        const catalogValues = selectedCatalog(definition['x-ui'].catalog);
        const fieldName = definition.title;
        const hint = field === 'subject' ? '候補から選択、または自由入力' : '候補から選択または入力';
        return `<div class="lesson-field field-${field}">
          <label for="${listId}-input">${escapeHtml(fieldName)}</label>
          <input class="form-control" id="${listId}-input" type="text" role="combobox" aria-autocomplete="list" list="${listId}"
            autocomplete="off" data-role="lesson-field" data-day-index="${dayIndex}" data-slot-index="${slotIndex}" data-field="${field}"
            value="${escapeHtml(slot[field])}" placeholder="${escapeHtml(hint)}" required>
          <datalist id="${listId}">${catalogValues.map((value) => `<option value="${escapeHtml(value)}"></option>`).join('')}</datalist>
        </div>`;
      }).join('')}
    </div>
  </article>`;
}

function lessonsMarkup() {
  const dayIndex = state.activeDay;
  const count = state.counts[dayIndex] ?? 0;
  const slots = state.slots[dayIndex];
  const historyNote = slots.some((slot) => slot._auto) ? `<div class="history-note">${icon('clock-history')} 科目に一致した過去の入力から教員・教室を補完しました。内容は編集できます。</div>` : '';
  return `
    <section class="panel-card lessons-panel" aria-labelledby="lessons-title">
      <div class="panel-heading">
        <div class="step-number">${String(dayIndex + 2).padStart(2, '0')}</div>
        <div>
          <p class="eyebrow">${escapeHtml(state.grade)}年 ${escapeHtml(state.className)}組 · ${escapeHtml(state.department)} · ${count}時限</p>
          <h2 id="lessons-title">${dayLabels[dayIndex]}の時間割</h2>
        </div>
        <button class="btn btn-sm btn-outline-secondary ms-auto" data-action="change-count">時限数を変更</button>
      </div>
      <p class="panel-intro">各時限の科目・教員・教室を入力します。入力後はTabで次の欄へ移動できます。</p>
      ${historyNote}
      <div class="lesson-list">${slots.slice(0, count).map((slot, index) => renderLessonSlot(slot, index)).join('')}</div>
      <div class="day-navigation">
        <button class="btn btn-outline-secondary" data-action="previous-day" ${dayIndex === 0 ? 'disabled' : ''}>${icon('arrow-left')} 前の曜日</button>
        <button class="btn btn-primary btn-lg" data-action="complete-day">${dayIndex === dayNames.length - 1 ? '週の入力を確認' : `${dayLabels[dayIndex + 1]}へ進む`} ${icon('arrow-right')}</button>
      </div>
      <p class="keyboard-hint">${icon('keyboard')} Enterで次の入力欄へ。最後の欄からボタンへ移動します。</p>
    </section>`;
}

function reviewMarkup() {
  const result = validationSummary();
  const complete = isComplete() && result.valid;
  const lessons = state.slots.reduce((sum, day) => sum + day.length, 0);
  return `<section class="panel-card review-panel" aria-labelledby="review-title">
    <div class="panel-heading">
      <div class="step-number">09</div>
      <div><p class="eyebrow">入力完了</p><h2 id="review-title">JSONを確認</h2></div>
    </div>
    <p class="panel-intro">入力内容を確認し、JSONファイルとして保存できます。</p>
    <div class="review-stats">
      <div><span>対象</span><strong>${escapeHtml(state.grade)}年 ${escapeHtml(state.className)}組（${escapeHtml(state.department)}）</strong></div>
      <div><span>授業数</span><strong>${lessons} コマ</strong></div>
      <div><span>スキーマ検証</span><strong class="${complete ? 'text-success' : 'text-danger'}">${complete ? `${icon('check-circle')} 有効` : `${icon('exclamation-circle')} 入力を確認`}</strong></div>
    </div>
    <div class="review-days">${dayNames.map((day, index) => `<button class="review-day ${state.completed[index] ? 'is-complete' : ''}" data-action="edit-day" data-index="${index}"><span>${dayLabels[index]}</span><strong>${state.slots[index].length}時限</strong>${icon('chevron-right')}</button>`).join('')}</div>
    <div class="day-navigation">
      <button class="btn btn-outline-secondary" data-action="edit-setup">${icon('arrow-left')} 学年・クラスを変更</button>
      <button class="btn btn-primary btn-lg" data-action="download" ${complete ? '' : 'disabled'}>${icon('download')} JSONを保存</button>
    </div>
    ${!complete ? '<p class="validation-message">全曜日の入力を完了し、科目・教員・教室を入力すると保存できます。</p>' : ''}
  </section>`;
}

function currentMainMarkup() {
  if (state.screen === 'setup') return setupMarkup();
  if (state.screen === 'count') return countMarkup();
  if (state.screen === 'lessons') return lessonsMarkup();
  return reviewMarkup();
}

function jsonMarkup() {
  if (!state.grade) return `<div class="json-empty"><div class="json-empty-icon">{ }</div><p>学年とクラスを選ぶと、JSONプレビューを表示します。</p></div>`;
  const result = validationSummary();
  const message = result.valid && isComplete() ? 'スキーマに適合' : '入力途中';
  return `<div class="json-status ${result.valid ? 'valid' : ''}"><span class="status-dot"></span>${message}</div><pre class="json-code"><code>${escapeHtml(JSON.stringify(dataObject(), null, 2))}</code></pre>`;
}

function updateAside() {
  const output = document.querySelector('#json-output');
  if (output) output.innerHTML = jsonMarkup();
  const downloadButton = document.querySelector('[data-action="download"]');
  if (downloadButton) downloadButton.disabled = !(isComplete() && validationSummary().valid);
  const copyButton = document.querySelector('[data-action="copy-json"]');
  if (copyButton) copyButton.disabled = !state.grade;
  const complete = state.completed.filter(Boolean).length;
  const percent = Math.round((complete / dayNames.length) * 100);
  const progress = document.querySelector('#week-progress');
  if (progress) {
    progress.style.width = `${percent}%`;
    progress.setAttribute('aria-valuenow', String(percent));
  }
  const progressTrack = document.querySelector('.progress-row .progress');
  if (progressTrack) progressTrack.setAttribute('aria-valuenow', String(percent));
  const progressLabel = document.querySelector('#progress-label');
  if (progressLabel) progressLabel.textContent = `${complete} / ${dayNames.length} 曜日`;
}

function render(focusSelector = null) {
  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <a class="brand" href="#" data-action="home" aria-label="時間割 JSON 入力ツール">
          <span class="brand-mark">K</span><span>香川高専<span class="brand-divider">/</span>時間割入力</span>
        </a>
        <div class="topbar-meta"><span class="saved-indicator">${icon('cloud-check')} この端末に自動保存</span><button class="btn btn-sm btn-light" data-action="reset">${icon('arrow-counterclockwise')} 最初から</button></div>
      </header>
      <main class="container-fluid workspace">
        <section class="page-heading">
          <div><p class="page-kicker">TIMETABLE DATA ENTRY</p><h1>時間割をJSONにする</h1><p class="page-description">PDFを見ながら、曜日ごとに授業を入力します。</p></div>
          <div class="schema-badge"><span>JSON Schema</span><strong>v1.0.0</strong></div>
        </section>
        <div class="progress-row"><div class="progress" role="progressbar" aria-label="週の入力進捗" aria-valuemin="0" aria-valuemax="100"><div id="week-progress" class="progress-bar" style="width:0%"></div></div><span id="progress-label">0 / 7 曜日</span></div>
        ${state.screen !== 'setup' ? weekRailMarkup() : ''}
        <div class="workspace-grid">
          <div class="primary-column">${currentMainMarkup()}</div>
          <aside class="json-panel" aria-labelledby="json-panel-title">
            <div class="json-panel-heading"><div><p class="eyebrow">OUTPUT</p><h2 id="json-panel-title">JSONプレビュー</h2></div><button class="btn btn-sm btn-outline-secondary" data-action="copy-json" ${state.grade ? '' : 'disabled'}>${icon('copy')} コピー</button></div>
            <div id="json-output">${jsonMarkup()}</div>
            <div class="schema-footnote">${icon('shield-check')} <span>出力時に <code>src/schedule.schema.json</code> で検証します。</span></div>
          </aside>
        </div>
        <footer class="page-footer"><span>候補データは <code>src/catalogs/</code> のTOMLから読み込みます。</span><span>キーボード操作：Tabで移動 · Enterで次へ</span></footer>
      </main>
      <div class="toast-container position-fixed bottom-0 end-0 p-3"><div id="app-toast" class="toast" role="status" aria-live="polite"><div class="toast-body"></div></div></div>
    </div>`;
  updateAside();
  const autofocus = (focusSelector && app.querySelector(focusSelector)) || app.querySelector('[autofocus]') || app.querySelector('[data-count]') || app.querySelector('[data-role="lesson-field"]') || app.querySelector('[data-action="edit-day"]');
  if (autofocus && !window.matchMedia('(pointer: coarse)').matches) requestAnimationFrame(() => autofocus.focus());
}

function persistHistory() {
  const history = readHistory();
  const newItems = [];
  state.slots.forEach((day) => day.forEach((slot) => {
    const subject = slot.subject.trim();
    const teacher = slot.teacher.trim();
    const room = slot.room.trim();
    if (!subject || !teacher || !room) return;
    newItems.push({ department: state.department, subject, teacher, room, at: Date.now() });
  }));
  const existingSignatures = new Set(history.slice(-300).map((item) => `${item.department}\u0000${item.subject}\u0000${item.teacher}\u0000${item.room}`));
  for (const item of newItems) {
    const signature = `${item.department}\u0000${item.subject}\u0000${item.teacher}\u0000${item.room}`;
    if (!existingSignatures.has(signature)) {
      history.push(item);
      existingSignatures.add(signature);
    }
  }
  writeHistory(history);
}

function historySuggestion(subject) {
  const exact = subject.trim();
  if (!exact) return null;
  const matches = readHistory().filter((item) => item.department === state.department && item.subject === exact && item.teacher && item.room);
  if (!matches.length) return null;
  const pairs = new Map();
  matches.forEach((item) => {
    const key = `${item.teacher}\u0000${item.room}`;
    pairs.set(key, (pairs.get(key) || 0) + 1);
  });
  const [pair, frequency] = [...pairs.entries()].sort((a, b) => b[1] - a[1])[0];
  const [teacher, room] = pair.split('\u0000');
  return { teacher, room, frequency };
}

function showToast(message) {
  const toast = document.querySelector('#app-toast');
  if (!toast) return;
  toast.querySelector('.toast-body').textContent = message;
  if (window.bootstrap?.Toast) window.bootstrap.Toast.getOrCreateInstance(toast).show();
  else {
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2200);
  }
}

function saveSlotField(target) {
  const dayIndex = Number(target.dataset.dayIndex);
  const slotIndex = Number(target.dataset.slotIndex);
  const field = target.dataset.field;
  const slot = state.slots[dayIndex]?.[slotIndex];
  if (!slot || !fields.includes(field)) return;
  slot[field] = target.value;
  if (field === 'subject') {
    const suggestion = historySuggestion(target.value);
    if (suggestion && (!slot.teacher || slot._auto) && (!slot.room || slot._auto)) {
      slot.teacher = suggestion.teacher;
      slot.room = suggestion.room;
      slot._auto = true;
      const teacherInput = app.querySelector(`[data-day-index="${dayIndex}"][data-slot-index="${slotIndex}"][data-field="teacher"]`);
      const roomInput = app.querySelector(`[data-day-index="${dayIndex}"][data-slot-index="${slotIndex}"][data-field="room"]`);
      if (teacherInput) teacherInput.value = suggestion.teacher;
      if (roomInput) roomInput.value = suggestion.room;
      const note = app.querySelector('.history-note');
      if (!note) {
        const list = app.querySelector('.lesson-list');
        list?.insertAdjacentHTML('beforebegin', `<div class="history-note">${icon('clock-history')} 科目に一致した過去の入力から教員・教室を補完しました。内容は編集できます。</div>`);
      }
    }
  } else if (slot._auto) slot._auto = false;
  saveDraft();
  updateAside();
}

function firstIncompleteSlot() {
  for (let dayIndex = 0; dayIndex < dayNames.length; dayIndex += 1) {
    const count = state.counts[dayIndex] ?? 0;
    for (let slotIndex = 0; slotIndex < count; slotIndex += 1) {
      const slot = state.slots[dayIndex][slotIndex];
      if (!slot || fields.some((field) => !slot[field].trim())) return { dayIndex, slotIndex };
    }
  }
  return null;
}

function enterLessons() {
  const dayIndex = state.activeDay;
  const count = state.counts[dayIndex];
  if (count === null) return;
  const old = state.slots[dayIndex];
  state.slots[dayIndex] = Array.from({ length: count }, (_, index) => old[index] || emptySlot());
  if (count === 0) {
    state.completed[dayIndex] = true;
    persistHistory();
    if (dayIndex === dayNames.length - 1) state.screen = 'review';
    else {
      state.activeDay += 1;
      state.screen = 'count';
    }
  } else {
    state.completed[dayIndex] = false;
    state.screen = 'lessons';
  }
  saveDraft();
  render();
}

function completeDay() {
  const dayIndex = state.activeDay;
  const count = state.counts[dayIndex] ?? 0;
  const missingIndex = state.slots[dayIndex].slice(0, count).findIndex((slot) => fields.some((field) => !slot[field].trim()));
  if (missingIndex >= 0) {
    const missingSlot = state.slots[dayIndex][missingIndex];
    const missingField = fields.find((field) => !missingSlot[field].trim());
    const target = app.querySelector(`[data-day-index="${dayIndex}"][data-slot-index="${missingIndex}"][data-field="${missingField}"]`);
    target?.focus();
    target?.classList.add('is-invalid');
    showToast(`${missingIndex + 1}時限目の${fieldDefs[missingField].title}を入力してください。`);
    return;
  }
  state.completed[dayIndex] = true;
  persistHistory();
  if (dayIndex === dayNames.length - 1) state.screen = 'review';
  else {
    state.activeDay += 1;
    state.screen = 'count';
  }
  saveDraft();
  render();
}

function goPreviousDay() {
  if (state.activeDay <= 0) return;
  state.activeDay -= 1;
  state.screen = state.counts[state.activeDay] === null ? 'count' : 'lessons';
  render();
}

function downloadJson() {
  if (!isComplete()) return;
  const { valid } = validationSummary();
  if (!valid) {
    showToast('JSON Schemaの検証に失敗しました。入力内容を確認してください。');
    return;
  }
  persistHistory();
  const blob = new Blob([`${JSON.stringify(dataObject(), null, 2)}\n`], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `時間割_${state.grade}年${state.className}_${state.department}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  showToast('JSONを保存しました。');
}

async function copyJson() {
  if (!state.grade) return;
  try {
    await navigator.clipboard.writeText(`${JSON.stringify(dataObject(), null, 2)}\n`);
    showToast('JSONをコピーしました。');
  } catch {
    showToast('コピーできませんでした。ブラウザーの権限を確認してください。');
  }
}

app = document.querySelector('#app');
app.addEventListener('input', (event) => {
  if (event.target.matches('[data-role="lesson-field"]')) saveSlotField(event.target);
});
app.addEventListener('change', (event) => {
  const target = event.target;
  if (target.matches('[data-setup="grade"]')) {
    state.grade = Number(target.value) || null;
    state.className = '';
    state.department = '';
    saveDraft();
    render('#className');
  } else if (target.matches('[data-setup="className"]')) {
    state.className = target.value;
    state.department = state.grade === 1 ? '' : classDepartment(target.value);
    saveDraft();
    render(state.grade === 1 ? '#department' : '[data-action="begin"]');
  } else if (target.matches('[data-setup="department"]')) {
    state.department = target.value;
    saveDraft();
    updateAside();
    const begin = app.querySelector('[data-action="begin"]');
    if (begin) begin.disabled = !(state.grade && state.className && state.department);
  } else if (target.matches('[data-count]')) {
    state.counts[state.activeDay] = target.value === '' ? null : Number(target.value);
    saveDraft();
    const button = app.querySelector('[data-action="confirm-count"]');
    if (button) {
      button.disabled = state.counts[state.activeDay] === null;
      button.innerHTML = `${state.counts[state.activeDay] === 0 ? 'この曜日を確定' : `${state.counts[state.activeDay] ?? ''}時限の入力へ`} ${icon('arrow-right')}`;
    }
  }
});

app.addEventListener('blur', (event) => {
  if (event.target.matches('[data-role="lesson-field"]')) {
    const { dayIndex, slotIndex } = event.target.dataset;
    const slot = state.slots[Number(dayIndex)]?.[Number(slotIndex)];
    if (slot && fields.every((field) => slot[field].trim())) persistHistory();
  }
}, true);

app.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && event.target.matches('[data-count]')) {
    event.preventDefault();
    state.counts[state.activeDay] = event.target.value === '' ? null : Number(event.target.value);
    enterLessons();
    return;
  }
  if (event.key !== 'Enter' || !event.target.matches('[data-role="lesson-field"]')) return;
  event.preventDefault();
  const controls = [...app.querySelectorAll('[data-role="lesson-field"]')];
  const index = controls.indexOf(event.target);
  if (index >= 0 && index < controls.length - 1) controls[index + 1].focus();
  else app.querySelector('[data-action="complete-day"]')?.focus();
});

app.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const { action } = button.dataset;
  if (action === 'begin') {
    if (!state.grade || !state.className || !state.department) return;
    state.screen = 'count';
    state.activeDay = 0;
    saveDraft();
    render();
  } else if (action === 'confirm-count') enterLessons();
  else if (action === 'complete-day') completeDay();
  else if (action === 'change-count' || action === 'back-to-count') {
    state.screen = 'count';
    render();
  } else if (action === 'previous-day') goPreviousDay();
  else if (action === 'edit-day') {
    state.activeDay = Number(button.dataset.index);
    state.screen = state.counts[state.activeDay] === null ? 'count' : state.counts[state.activeDay] === 0 ? 'count' : 'lessons';
    render();
  } else if (action === 'edit-setup') {
    const hasSchedule = state.completed.some(Boolean) || state.slots.some((day) => day.some((slot) => fields.some((field) => slot[field])));
    if (hasSchedule && !window.confirm('学年・クラスを変更すると、入力済みの週時間割を消去します。続けますか？')) return;
    if (hasSchedule) {
      state.counts = Array(dayNames.length).fill(null);
      state.slots = Array.from({ length: dayNames.length }, () => []);
      state.completed = Array(dayNames.length).fill(false);
      state.activeDay = 0;
    }
    state.screen = 'setup';
    saveDraft();
    render();
  } else if (action === 'download') downloadJson();
  else if (action === 'copy-json') copyJson();
  else if (action === 'reset' || action === 'home') {
    if (action === 'reset' && !window.confirm('入力中の時間割を消去して、最初からやり直しますか？')) return;
    state = freshState();
    localStorage.removeItem(STORAGE_KEY);
    render();
  }
});

try {
  render();
} catch (error) {
  console.error('Unable to render timetable editor', error);
  app.innerHTML = `<main style="padding:2rem;font-family:system-ui"><h1>画面を表示できません</h1><pre>${escapeHtml(error?.stack || error)}</pre></main>`;
}

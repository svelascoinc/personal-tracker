const STORAGE_KEY = 'tracker-v1';

// ─── THEME ────────────────────────────────────────────────────────────────────

(function initTheme() {
  const saved = localStorage.getItem('tracker-theme');
  const preferred = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  const theme = saved || preferred;
  document.documentElement.dataset.theme = theme;
  const btn = document.getElementById('btn-theme');
  if (btn) btn.textContent = theme === 'dark' ? '☀' : '☾';
})();

function toggleTheme() {
  const curr = document.documentElement.dataset.theme || 'dark';
  const next = curr === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('tracker-theme', next);
  const btn = document.getElementById('btn-theme');
  if (btn) btn.textContent = next === 'dark' ? '☀' : '☾';
}

function getUpcomingWeeks(count = 6) {
  const weeks = [];
  const d = new Date();
  for (let i = 1; i <= count; i++) {
    const nd = new Date(d);
    nd.setDate(nd.getDate() + i * 7);
    const id = getWeekId(nd);
    if (!weeks.find(w => w.id === id)) weeks.push({ id, range: getWeekRange(id) });
  }
  return weeks;
}

let state = {
  schemaVersion: 2,
  updatedAt: null,
  tasks: [],
  habits: [],
  sprints: [],
  epics: [],
  currentSprintId: null
};

// ─── SCHEMA MIGRATION ────────────────────────────────────────────────────────

function migrateSchema(data) {
  if (!data.schemaVersion) {
    data.schemaVersion = 1;
    data.updatedAt = data.updatedAt || nowISO();
    (data.tasks || []).forEach(t => {
      t.calendarEventId   = t.calendarEventId   ?? null;
      t.calendarEventLink = t.calendarEventLink ?? null;
      t.checkInEventIds   = t.checkInEventIds   ?? [];
      t.epicId            = t.epicId            ?? null;
      t.deletedAt         = t.deletedAt         ?? null;
      t.updatedAt         = t.updatedAt         ?? nowISO();
      if (!['todo','doing','done','deleted'].includes(t.status)) t.status = 'todo';
    });
    (data.habits || []).forEach(h => { h.active = h.active ?? true; });
    if (!data.epics) data.epics = [];
  }
  if (data.schemaVersion < 2) {
    data.schemaVersion = 2;
    (data.tasks || []).forEach(t => {
      t.habitId        = t.habitId        ?? null;
      t.targetSprintId = t.targetSprintId ?? null;
    });
    (data.habits || []).forEach(h => {
      h.status      = h.status      ?? (h.active !== false ? 'active' : 'inactive');
      h.description = h.description ?? (h.goal || '');
    });
  }
  return data;
}

// ─── PERSIST ─────────────────────────────────────────────────────────────────

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) state = migrateSchema(JSON.parse(raw));
  } catch(e) {}
  autoAdvanceSprint();
  if (!state.currentSprintId) initSprint();
  syncHabitTasks();
  render();
}

function save() {
  state.updatedAt = nowISO();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  Drive.sync();
}

// ─── SPRINT ───────────────────────────────────────────────────────────────────

function initSprint() {
  const id = getWeekId();
  if (!state.sprints.find(s => s.id === id)) {
    state.sprints.push({ id, range: getWeekRange(id), closed: false, closedAt: null, createdAt: today() });
  }
  state.currentSprintId = id;
  // Migrate backlog tasks scheduled for this sprint
  state.tasks
    .filter(t => t.targetSprintId === id && !t.sprintId && t.status !== 'deleted')
    .forEach(t => { t.sprintId = id; t.targetSprintId = null; t.updatedAt = nowISO(); });
  save();
}

function autoAdvanceSprint() {
  const currentWeek = getWeekId();
  if (!state.currentSprintId || state.currentSprintId === currentWeek) return;
  const old = state.sprints.find(s => s.id === state.currentSprintId);
  if (old && !old.closed) { old.closed = true; old.closedAt = today(); }
  // Roll over non-habit pending tasks
  state.tasks
    .filter(t => t.sprintId === state.currentSprintId && t.status !== 'done' && t.status !== 'deleted' && !t.habitId)
    .forEach(t => { t.rolledOver = true; });
  initSprint();
  state.tasks
    .filter(t => t.rolledOver && t.status !== 'done')
    .forEach(t => { t.sprintId = state.currentSprintId; delete t.rolledOver; });
}

function syncHabitTasks() {
  const activeHabits = (state.habits || []).filter(h => (h.status || 'active') === 'active');
  let changed = false;
  for (const h of activeHabits) {
    const exists = state.tasks.find(t =>
      t.habitId === h.id && t.createdAt === today() &&
      t.sprintId === state.currentSprintId && t.status !== 'deleted'
    );
    if (!exists) {
      const doneToday = (h.log || []).includes(today());
      state.tasks.push({
        id: uid(), title: h.name,
        firstStep: h.description || h.goal || '',
        category: 'hábito', priority: 'medium',
        due: today(), status: doneToday ? 'done' : 'todo',
        sprintId: state.currentSprintId,
        calendarEventId: null, calendarEventLink: null, checkInEventIds: [],
        epicId: null, habitId: h.id, targetSprintId: null,
        createdAt: today(), updatedAt: nowISO(),
        completedAt: doneToday ? today() : null, deletedAt: null
      });
      changed = true;
    }
  }
  if (changed) save();
}

function currentSprint() {
  return state.sprints.find(s => s.id === state.currentSprintId) || {};
}

function closeSprint() {
  if (!confirm('¿Cerrar el sprint actual y comenzar uno nuevo?')) return;
  const sp = currentSprint();
  if (sp) { sp.closed = true; sp.closedAt = today(); }

  state.tasks
    .filter(t => t.sprintId === state.currentSprintId && t.status !== 'done' && t.status !== 'deleted')
    .forEach(t => t.rolledOver = true);

  initSprint();

  state.tasks
    .filter(t => t.rolledOver && t.status !== 'done')
    .forEach(t => { t.sprintId = state.currentSprintId; delete t.rolledOver; });

  save(); render();
}

// ─── RENDER ───────────────────────────────────────────────────────────────────

function render() {
  renderKanban();
  renderHabits();
  renderStats();
  renderHistory();
  renderEpics();
  renderBacklog();
  Pomodoro.updateTasks();
  const sp = currentSprint();
  document.getElementById('header-sprint').textContent = state.currentSprintId || '—';
  document.getElementById('sprint-title').textContent  = `Sprint ${state.currentSprintId || ''}`;
  document.getElementById('sprint-range').textContent  = sp.range || '';
}

function renderKanban() {
  const sprintTasks = state.tasks.filter(t => t.sprintId === state.currentSprintId && t.status !== 'deleted');
  const cols = { todo: [], doing: [], done: [] };
  sprintTasks.forEach(t => { if (cols[t.status]) cols[t.status].push(t); });

  const overdue = sprintTasks.filter(t => t.due && t.due < today() && t.status !== 'done');
  const banner  = document.getElementById('overdue-banner');
  if (overdue.length) {
    banner.classList.add('visible');
    document.getElementById('overdue-text').textContent =
      `${overdue.length} tarea${overdue.length > 1 ? 's' : ''} vencida${overdue.length > 1 ? 's' : ''} — requieren atención.`;
  } else {
    banner.classList.remove('visible');
  }

  ['todo','doing','done'].forEach(s => {
    document.getElementById('cnt-'+s).textContent = cols[s].length;
    const el = document.getElementById('col-'+s);
    if (!cols[s].length) { el.innerHTML = '<div class="empty-col">— vacío —</div>'; return; }
    el.innerHTML = cols[s].map(t => taskCardHTML(t, s)).join('');
  });
  _initDragDrop();
}

function taskCardHTML(t, col) {
  const od       = t.due && t.due < today() && col !== 'done';
  const priClass = { high:'pri-high', medium:'pri-medium', low:'pri-low' }[t.priority] || 'pri-medium';
  const doneTitle = col === 'done' ? 'done-title' : '';
  const epic     = t.epicId ? (state.epics || []).find(e => e.id === t.epicId) : null;
  return `<div class="task-card ${od ? 'overdue' : ''}" draggable="true" data-id="${t.id}">
    <div class="task-card-top">
      <div class="task-title ${doneTitle}">${t.title}</div>
      <div class="pri-dot ${priClass}"></div>
    </div>
    <div class="task-meta">
      <span class="tag tag-cat">${t.category}</span>
      ${epic ? `<span class="tag tag-epic" style="background:${epic.color}22;color:${epic.color};border-color:${epic.color}55">${epic.title}</span>` : ''}
      ${t.due ? `<span class="tag-date ${od ? 'overdue' : ''}">${t.due}</span>` : ''}
    </div>
    ${t.firstStep ? `<div class="first-step">${t.firstStep}</div>` : ''}
    <div class="task-actions">
      ${col === 'todo'  ? `<button class="task-btn primary" onclick="moveTask('${t.id}','doing')">→ iniciar</button>` : ''}
      ${col === 'doing' ? `<button class="task-btn primary" onclick="moveTask('${t.id}','done')">✓ completar</button>` : ''}
      ${col !== 'done'  ? `<button class="task-btn cal"     onclick="taskToCalendar('${t.id}')">📅 calendar</button>` : ''}
      <button class="task-btn" onclick="openEditTask('${t.id}')">✎ editar</button>
      <button class="task-btn danger" onclick="deleteTask('${t.id}')">✕</button>
    </div>
  </div>`;
}

function renderHistory() {
  const closed = state.sprints.filter(s => s.closed).reverse();
  const el     = document.getElementById('history-content');
  if (!closed.length) {
    el.innerHTML = '<div style="color:var(--text3);font-size:13px;padding:40px 0;text-align:center;">Sin sprints cerrados todavía.</div>';
    return;
  }
  const grid = closed.map(sp => {
    const tasks = state.tasks.filter(t => t.sprintId === sp.id && t.status !== 'deleted');
    const done  = tasks.filter(t => t.status === 'done').length;
    const total = tasks.length;
    const pct   = total ? Math.round((done / total) * 100) : 0;
    const fill  = pct >= 70 ? 'var(--accent)' : pct >= 40 ? 'var(--amber)' : 'var(--red)';
    return `<div class="history-card">
      <div class="history-card-head">
        <div>
          <div class="history-sprint-name">${sp.id}</div>
          <div style="font-size:11px;color:var(--text3)">${sp.range}</div>
        </div>
        <div class="history-pct" style="color:${fill}">${pct}%</div>
      </div>
      <div class="history-bar"><div class="history-bar-fill" style="width:${pct}%;background:${fill}"></div></div>
      <div class="history-stats">
        <div>completadas <span>${done}</span></div>
        <div>total <span>${total}</span></div>
        <div>cerrado <span>${sp.closedAt || '—'}</span></div>
      </div>
    </div>`;
  }).join('');
  el.innerHTML = `<div class="history-grid">${grid}</div>`;
}

function renderHabits() {
  const el = document.getElementById('habits-grid');
  if (!el) return;
  const visible = state.habits.filter(h => h.status !== 'archived');
  if (!visible.length) {
    el.innerHTML = '<div style="color:var(--text3);font-size:13px;padding:20px 0">Sin hábitos registrados. Agrega uno.</div>';
    return;
  }
  el.innerHTML = visible.map(h => habitCardHTML(h)).join('');
}

function habitCardHTML(h) {
  const last14     = getLast14(h);
  const filled     = last14.filter(Boolean).length;
  const pct        = Math.round((filled / 14) * 100);
  const streak     = getStreak(h);
  const doneToday  = (h.log || []).includes(today());
  const totalDone  = (h.log || []).length;
  const status     = h.status || 'active';
  const statusLabel = { active: 'activo', inactive: 'inactivo', archived: 'archivado' }[status];
  const statusColor = { active: 'var(--accent)', inactive: 'var(--text3)', archived: 'var(--amber)' }[status];
  const dots = last14.map((v, i) =>
    `<div class="habit-dot ${v ? 'filled' : i === 13 ? 'today-empty' : ''}"></div>`
  ).join('');
  return `<div class="habit-card">
    <div class="habit-head">
      <div class="habit-name">${h.name}</div>
      <span class="habit-status-badge" style="color:${statusColor}">${statusLabel}</span>
    </div>
    ${h.description || h.goal ? `<div class="habit-goal">${h.description || h.goal}</div>` : ''}
    <div class="habit-stats-row">
      <div class="streak-display">
        <div class="streak-num">${streak}</div>
        <div class="streak-label">días<br>seguidos</div>
      </div>
      <div class="habit-total-block">
        <div class="streak-num">${totalDone}</div>
        <div class="streak-label">total<br>ejecutado</div>
      </div>
    </div>
    <div class="habit-dots">${dots}</div>
    <div class="habit-pct"><span>${pct}%</span> últimos 14 días</div>
    ${status === 'active' ? `
    <button class="check-btn ${doneToday ? 'checked' : ''}" onclick="checkHabit('${h.id}')">
      ${doneToday ? '✓ ejecutado hoy' : '— pendiente hoy'}
    </button>` : ''}
    <div class="habit-actions">
      ${status === 'inactive' ? `<button class="task-btn primary" onclick="setHabitStatus('${h.id}','active')">▶ activar</button>` : ''}
      ${status === 'active'   ? `<button class="task-btn"         onclick="setHabitStatus('${h.id}','inactive')">⏸ pausar</button>` : ''}
      <button class="task-btn" onclick="openEditHabit('${h.id}')">✎ editar</button>
      <button class="task-btn danger" onclick="setHabitStatus('${h.id}','archived')">✕</button>
    </div>
  </div>`;
}

function getLast14(h) {
  return Array.from({length:14}, (_,i) => {
    const d = new Date(); d.setDate(d.getDate() - (13 - i));
    return (h.log || []).includes(d.toISOString().slice(0,10));
  });
}

function getStreak(h) {
  let streak = 0;
  const d    = new Date();
  while (true) {
    if ((h.log || []).includes(d.toISOString().slice(0,10))) { streak++; d.setDate(d.getDate()-1); }
    else break;
  }
  return streak;
}

function renderStats() {
  const activeTasks = state.tasks.filter(t => t.status !== 'deleted');
  const allDone     = activeTasks.filter(t => t.status === 'done').length;
  const allTotal    = activeTasks.length;
  const overdue     = activeTasks.filter(t => t.due && t.due < today() && t.status !== 'done').length;
  const maxStreak   = state.habits.length ? Math.max(...state.habits.map(getStreak)) : 0;
  const pct         = allTotal ? Math.round((allDone / allTotal) * 100) : 0;
  const epics       = state.epics || [];
  const epicActive  = epics.filter(e => e.status !== 'done').length;
  const epicDone    = epics.filter(e => e.status === 'done').length;

  document.getElementById('stats-range').textContent = `Total acumulado · ${state.sprints.length} sprints`;
  document.getElementById('stats-top').innerHTML = `
    <div class="stat-card"><div class="stat-label">Cumplimiento global</div><div class="stat-val accent">${pct}%</div><div class="stat-sub">${allDone} de ${allTotal} tareas</div></div>
    <div class="stat-card"><div class="stat-label">Vencidas ahora</div><div class="stat-val ${overdue ? 'danger' : ''}">${overdue}</div><div class="stat-sub">requieren acción</div></div>
    <div class="stat-card"><div class="stat-label">Épicas activas</div><div class="stat-val accent">${epicActive}</div><div class="stat-sub">${epicDone} completadas</div></div>
    <div class="stat-card"><div class="stat-label">Mejor racha</div><div class="stat-val accent">${maxStreak}</div><div class="stat-sub">días consecutivos</div></div>
    <div class="stat-card"><div class="stat-label">Sprints totales</div><div class="stat-val">${state.sprints.length}</div><div class="stat-sub">${state.sprints.filter(s=>s.closed).length} cerrados</div></div>
  `;

  const chartEl = document.getElementById('chart-sprints');
  const last6   = state.sprints.slice(-6);
  if (!last6.length) { chartEl.innerHTML = '<div style="color:var(--text3);font-size:11px">Sin datos</div>'; }
  else {
    const maxVal = Math.max(...last6.map(sp =>
      state.tasks.filter(t => t.sprintId === sp.id && t.status === 'done').length
    ), 1);
    chartEl.innerHTML = last6.map(sp => {
      const val = state.tasks.filter(t => t.sprintId === sp.id && t.status === 'done').length;
      const h   = Math.round((val / maxVal) * 100);
      return `<div class="bar-wrap">
        <div class="bar-val">${val}</div>
        <div class="bar" style="height:${h}%"></div>
        <div class="bar-lbl">${sp.id.split('-W')[1] ? 'W'+sp.id.split('-W')[1] : sp.id}</div>
      </div>`;
    }).join('');
  }

  const habEl = document.getElementById('chart-habits');
  if (!state.habits.length) { habEl.innerHTML = '<div style="color:var(--text3);font-size:11px">Sin hábitos</div>'; }
  else {
    habEl.innerHTML = state.habits.map(h => {
      const pct = Math.round((getLast14(h).filter(Boolean).length / 14) * 100);
      const cls = pct >= 70 ? 'good' : pct >= 40 ? 'warn' : 'bad';
      return `<div class="hbar-row">
        <div class="hbar-name">${h.name}</div>
        <div class="hbar-track"><div class="hbar-fill ${cls}" style="width:${pct}%"></div></div>
        <div class="hbar-pct">${pct}%</div>
      </div>`;
    }).join('');
  }

  const epicEl = document.getElementById('chart-epics');
  if (epicEl) {
    if (!epics.length) {
      epicEl.innerHTML = '<div style="color:var(--text3);font-size:11px">Sin épicas creadas.</div>';
    } else {
      epicEl.innerHTML = epics.map(epic => {
        const tasks  = activeTasks.filter(t => t.epicId === epic.id);
        const done   = tasks.filter(t => t.status === 'done').length;
        const total  = tasks.length;
        const p      = total ? Math.round((done / total) * 100) : 0;
        const closed = epic.status === 'done' ? ' ✓' : '';
        return `<div class="hbar-row">
          <div class="hbar-name" style="color:${epic.color}">${epic.title}${closed}</div>
          <div class="hbar-track"><div class="hbar-fill" style="width:${p}%;background:${epic.color}"></div></div>
          <div class="hbar-pct">${p}%</div>
        </div>`;
      }).join('');
    }
  }
}

// ─── DRAG & DROP ──────────────────────────────────────────────────────────────

let _draggedId   = null;
let _placeholder = null;

function _initDragDrop() {
  document.querySelectorAll('.task-card[draggable="true"]').forEach(card => {
    card.addEventListener('dragstart', _onDragStart);
    card.addEventListener('dragend',   _onDragEnd);
  });
  ['todo', 'doing', 'done'].forEach(status => {
    const col = document.getElementById('col-' + status);
    if (!col) return;
    col.addEventListener('dragover',  e => _onDragOver(e, status));
    col.addEventListener('dragleave', _onDragLeave);
    col.addEventListener('drop',      e => _onDrop(e, status));
  });
}

function _onDragStart(e) {
  _draggedId = e.currentTarget.dataset.id;
  e.dataTransfer.effectAllowed = 'move';
  requestAnimationFrame(() => e.currentTarget.classList.add('dragging'));
}

function _onDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  _cleanupDrag();
  _draggedId = null;
}

function _onDragOver(e, status) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const col = document.getElementById('col-' + status);
  if (!col) return;
  col.classList.add('drag-over');
  if (!_placeholder) {
    _placeholder = document.createElement('div');
    _placeholder.className = 'drop-placeholder';
  }
  const after = _getDragAfterElement(col, e.clientY);
  if (after) col.insertBefore(_placeholder, after);
  else        col.appendChild(_placeholder);
}

function _onDragLeave(e) {
  const col = e.currentTarget;
  if (col.contains(e.relatedTarget)) return;
  col.classList.remove('drag-over');
  if (_placeholder && _placeholder.parentNode === col) col.removeChild(_placeholder);
}

function _onDrop(e, status) {
  e.preventDefault();
  _cleanupDrag();
  if (!_draggedId) return;
  const task = state.tasks.find(t => t.id === _draggedId);
  if (!task || task.status === status) return;
  moveTask(_draggedId, status);
}

function _cleanupDrag() {
  document.querySelectorAll('.col-body').forEach(col => col.classList.remove('drag-over'));
  if (_placeholder && _placeholder.parentNode) _placeholder.parentNode.removeChild(_placeholder);
  _placeholder = null;
}

function _getDragAfterElement(container, y) {
  const cards = [...container.querySelectorAll('.task-card:not(.dragging)')];
  return cards.reduce((closest, child) => {
    const box    = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    return (offset < 0 && offset > closest.offset) ? { offset, element: child } : closest;
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

// ─── ACCIONES ─────────────────────────────────────────────────────────────────


function moveTask(id, status) {
  const t = state.tasks.find(t => t.id === id);
  if (!t) return;
  const prevStatus = t.status;
  t.status    = status;
  t.updatedAt = nowISO();

  if (status === 'done') {
    t.completedAt = today();
    // Sync habit log if this is a habit task
    if (t.habitId) {
      const h = state.habits.find(h => h.id === t.habitId);
      if (h) { if (!h.log) h.log = []; if (!h.log.includes(today())) h.log.push(today()); }
    }
    if (t.calendarEventId) {
      Calendar.deleteEvent(t.calendarEventId).catch(console.error);
      t.calendarEventId   = null;
      t.calendarEventLink = null;
    }
    if (t.checkInEventIds && t.checkInEventIds.length) {
      Calendar.deleteCheckIns(t.checkInEventIds).catch(console.error);
      t.checkInEventIds = [];
    }
  } else if (status === 'doing' && prevStatus !== 'doing') {
    // Mover a "doing": crear evento si no existe + crear check-ins en Calendar
    if (!t.calendarEventId) {
      Calendar.createEvent(t).then(ev => { t.calendarEventId = ev.id; t.calendarEventLink = ev.htmlLink; save(); }).catch(console.error);
    }
    Calendar.createCheckIns(t).then(ids => { t.checkInEventIds = ids; save(); }).catch(console.error);
    Reminders.notify(); // notificación inmediata de inicio
  } else if (status === 'todo' && prevStatus === 'doing') {
    // Regresa a pendiente: limpiar check-ins
    if (t.checkInEventIds && t.checkInEventIds.length) {
      Calendar.deleteCheckIns(t.checkInEventIds).catch(console.error);
      t.checkInEventIds = [];
    }
  }

  save(); render();
}

function deleteTask(id) {
  if (!confirm('¿Eliminar esta tarea?')) return;
  const t = state.tasks.find(t => t.id === id);
  if (!t) return;
  t.status    = 'deleted';
  t.deletedAt = today();
  t.updatedAt = nowISO();
  if (t.calendarEventId) {
    Calendar.deleteEvent(t.calendarEventId).catch(console.error);
    t.calendarEventId   = null;
    t.calendarEventLink = null;
  }
  if (t.checkInEventIds && t.checkInEventIds.length) {
    Calendar.deleteCheckIns(t.checkInEventIds).catch(console.error);
    t.checkInEventIds = [];
  }
  save(); render();
}

function checkHabit(id) {
  const h = state.habits.find(h => h.id === id);
  if (!h) return;
  if (!h.log) h.log = [];
  const d = today();
  const wasChecked = h.log.includes(d);
  h.log = wasChecked ? h.log.filter(x => x !== d) : [...h.log, d];
  // Sync associated daily task
  const task = state.tasks.find(t =>
    t.habitId === h.id && t.createdAt === d &&
    t.sprintId === state.currentSprintId && t.status !== 'deleted'
  );
  if (task) {
    task.status     = wasChecked ? 'todo' : 'done';
    task.completedAt = wasChecked ? null : d;
    task.updatedAt  = nowISO();
  }
  save(); render();
}

function taskToCalendar(id) {
  const t = state.tasks.find(t => t.id === id);
  if (!t) return;
  if (t.calendarEventLink) {
    window.open(t.calendarEventLink, '_blank');
  } else if (t.calendarEventId) {
    // Evento viejo sin htmlLink guardado — re-crear para obtenerlo
    Calendar.createEvent(t).then(ev => {
      t.calendarEventId   = ev.id;
      t.calendarEventLink = ev.htmlLink;
      save();
      if (ev.htmlLink) window.open(ev.htmlLink, '_blank');
    }).catch(console.error);
  } else {
    Calendar.createEvent(t).then(ev => {
      t.calendarEventId   = ev.id;
      t.calendarEventLink = ev.htmlLink;
      save();
      if (ev.htmlLink) window.open(ev.htmlLink, '_blank');
    }).catch(console.error);
  }
}

function sendAllToCalendar() {
  const pending = state.tasks.filter(t => t.sprintId === state.currentSprintId && t.status !== 'done' && t.status !== 'deleted');
  if (!pending.length) { alert('No hay tareas pendientes para enviar.'); return; }
  if (!confirm(`¿Crear ${pending.length} eventos en Google Calendar?`)) return;
  // Create events sequentially to avoid rate limits
  (async () => {
    for (const t of pending) {
      if (!t.calendarEventId) {
        try {
          const ev = await Calendar.createEvent(t);
          t.calendarEventId   = ev.id;
          t.calendarEventLink = ev.htmlLink;
        } catch (e) { console.error('Error creating event', e); }
      }
    }
    save();
    alert('Eventos creados en Calendar.');
  })();
}

// ─── REMINDERS ────────────────────────────────────────────────────────────────

const Reminders = (() => {
  let _interval       = null;
  let _enabled        = false;
  let _pendingCheckIn = false;

  async function enable() {
    if (!('Notification' in window)) { alert('Tu browser no soporta notificaciones.'); return; }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { alert('Permiso de notificaciones denegado.'); return; }
    _enabled = true;
    if (!_interval) _interval = setInterval(_check, 30 * 60 * 1000);
    _updateBtn();
  }

  function disable() {
    _enabled = false;
    clearInterval(_interval);
    _interval = null;
    _updateBtn();
  }

  function toggle() { _enabled ? disable() : enable(); }

  function notify() {
    if (!_enabled || Notification.permission !== 'granted') return;
    const doing = state.tasks.filter(t => t.sprintId === state.currentSprintId && t.status === 'doing');
    if (!doing.length) return;
    new Notification('▶ Tracker — Tarea iniciada', {
      body: doing.map(t => `• ${t.title}`).join('\n'),
      tag:  'tracker-start',
      icon: '/favicon.ico',
    });
  }

  function _check() {
    const doing = state.tasks.filter(t =>
      t.sprintId === state.currentSprintId && t.status === 'doing'
    );
    if (!doing.length) return;

    if (Notification.permission === 'granted') {
      const list = doing.map(t => `• ${t.title}`).join('\n');
      new Notification('⏱ Tracker — Check-in 30 min', {
        body:  `Todavía en progreso:\n${list}`,
        tag:   'tracker-checkin',
        icon:  '/favicon.ico',
      });
    }

    if (!document.hidden) {
      openCheckInModal(doing);
    } else {
      _pendingCheckIn = true;
    }
  }

  function _updateBtn() {
    const btn = document.getElementById('btn-reminders');
    if (!btn) return;
    btn.textContent = _enabled ? '🔔 ON' : '🔔 OFF';
    btn.classList.toggle('active', _enabled);
  }

  return {
    toggle, enable, disable, notify,
    isEnabled:          () => _enabled,
    hasPendingCheckIn:  () => _pendingCheckIn,
    clearPendingCheckIn: () => { _pendingCheckIn = false; },
  };
})();

// ─── EDICIÓN DE TAREAS ────────────────────────────────────────────────────────

function openEditTask(id) {
  const t = state.tasks.find(t => t.id === id);
  if (!t) return;
  const esc = s => (s || '').replace(/"/g, '&quot;');
  const activeEpics = (state.epics || []).filter(e => e.status !== 'done');
  const epicOpts = activeEpics.map(e =>
    `<option value="${e.id}" ${t.epicId === e.id ? 'selected' : ''}>${e.title}</option>`
  ).join('');
  const epicField = activeEpics.length
    ? `<div class="field"><label>Épica</label><select id="f-epic"><option value="" ${!t.epicId ? 'selected' : ''}>— sin épica —</option>${epicOpts}</select></div>`
    : '';
  showModal(`<div class="modal-title">Editar tarea</div>
    <div class="field"><label>Título</label><input id="f-title" value="${esc(t.title)}" autofocus/></div>
    <div class="field"><label>Descripción de tarea</label><input id="f-step" value="${esc(t.firstStep)}"/></div>
    <div class="field"><label>Categoría</label><select id="f-cat">
      ${['trabajo','aprendizaje','hábito','personal'].map(c =>
        `<option ${t.category === c ? 'selected' : ''}>${c}</option>`
      ).join('')}
    </select></div>
    <div class="field"><label>Prioridad</label><select id="f-pri">
      <option value="high"   ${t.priority === 'high'   ? 'selected' : ''}>Alta</option>
      <option value="medium" ${t.priority === 'medium' ? 'selected' : ''}>Media</option>
      <option value="low"    ${t.priority === 'low'    ? 'selected' : ''}>Baja</option>
    </select></div>
    <div class="field"><label>Fecha límite</label><input type="date" id="f-due" value="${t.due || ''}"/></div>
    ${epicField}
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-accent" onclick="saveEditTask('${id}')">Guardar</button>
    </div>`);
}

function saveEditTask(id) {
  const t = state.tasks.find(t => t.id === id);
  if (!t) return;
  const title = document.getElementById('f-title').value.trim();
  if (!title) return;
  t.title     = title;
  t.firstStep = document.getElementById('f-step').value.trim();
  t.category  = document.getElementById('f-cat').value;
  t.priority  = document.getElementById('f-pri').value;
  t.due       = document.getElementById('f-due').value;
  t.updatedAt = nowISO();
  const epicEl = document.getElementById('f-epic');
  if (epicEl) t.epicId = epicEl.value || null;
  if (t.calendarEventId) Calendar.updateEvent(t).catch(console.error);
  save(); closeModal(); render();
}

// ─── MODALES ──────────────────────────────────────────────────────────────────

function openAddTask(defaultStatus, epicIdPreset = null) {
  const activeEpics = (state.epics || []).filter(e => e.status !== 'done');
  const epicOpts = activeEpics.map(e =>
    `<option value="${e.id}" ${epicIdPreset === e.id ? 'selected' : ''}>${e.title}</option>`
  ).join('');
  const epicField = activeEpics.length
    ? `<div class="field"><label>Épica (opcional)</label><select id="f-epic"><option value="">— sin épica —</option>${epicOpts}</select></div>`
    : '';
  showModal(`<div class="modal-title">Nueva tarea</div>
    <div class="field"><label>Título</label><input id="f-title" placeholder="Nombre claro y accionable" autofocus/></div>
    <div class="field"><label>Descripción de tarea</label><input id="f-step" placeholder="Detalle opcional de la tarea"/></div>
    <div class="field"><label>Categoría</label><select id="f-cat">
      <option>trabajo</option><option>aprendizaje</option><option>hábito</option><option>personal</option>
    </select></div>
    <div class="field"><label>Prioridad</label><select id="f-pri">
      <option value="high">Alta</option><option value="medium" selected>Media</option><option value="low">Baja</option>
    </select></div>
    <div class="field"><label>Fecha límite</label><input type="date" id="f-due" value="${today()}"/></div>
    ${epicField}
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn" onclick="addTask(null, true)">→ Backlog</button>
      <button class="btn btn-accent" onclick="addTask('${defaultStatus}')">Agregar al sprint</button>
    </div>`);
}

function addTask(status, toBacklog = false) {
  const title = document.getElementById('f-title').value.trim();
  if (!title) return;
  const epicEl = document.getElementById('f-epic');
  const newTask = {
    id: uid(), title,
    firstStep:         document.getElementById('f-step').value.trim(),
    category:          document.getElementById('f-cat').value,
    priority:          document.getElementById('f-pri').value,
    due:               document.getElementById('f-due').value,
    status:            toBacklog ? 'todo' : status,
    sprintId:          toBacklog ? null : state.currentSprintId,
    calendarEventId:   null,
    calendarEventLink: null,
    checkInEventIds:   [],
    epicId:            epicEl ? (epicEl.value || null) : null,
    habitId:           null,
    targetSprintId:    null,
    createdAt:         today(),
    updatedAt:         nowISO(),
    completedAt:       null,
    deletedAt:         null
  };
  state.tasks.push(newTask);
  if (!toBacklog && status !== 'done') {
    Calendar.createEvent(newTask).then(ev => { newTask.calendarEventId = ev.id; newTask.calendarEventLink = ev.htmlLink; save(); }).catch(console.error);
  }
  save(); closeModal(); render();
  if (toBacklog) switchTab('backlog');
}

function openAddHabit() {
  showModal(`<div class="modal-title">Registrar hábito</div>
    <div class="field"><label>Nombre</label><input id="h-name" placeholder="Ej: Trabajo profundo" autofocus/></div>
    <div class="field"><label>Descripción / meta diaria</label><input id="h-desc" placeholder="Ej: 60 minutos sin distracciones"/></div>
    <div class="field"><label>Estado inicial</label><select id="h-status">
      <option value="inactive">Inactivo — solo registrar, no generar tareas</option>
      <option value="active">Activo — crear tarea diaria automáticamente</option>
    </select></div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-accent" onclick="addHabit()">Registrar</button>
    </div>`);
}

function addHabit() {
  const name = document.getElementById('h-name').value.trim();
  if (!name) return;
  const status = document.getElementById('h-status').value;
  state.habits.push({
    id: uid(), name,
    description: document.getElementById('h-desc').value.trim(),
    goal: document.getElementById('h-desc').value.trim(),
    log: [], status, active: status === 'active', createdAt: today(), updatedAt: nowISO()
  });
  save(); closeModal();
  if (status === 'active') syncHabitTasks();
  render();
}

function openEditHabit(id) {
  const h = state.habits.find(h => h.id === id);
  if (!h) return;
  const esc = s => (s || '').replace(/"/g, '&quot;');
  showModal(`<div class="modal-title">Editar hábito</div>
    <div class="field"><label>Nombre</label><input id="h-name" value="${esc(h.name)}" autofocus/></div>
    <div class="field"><label>Descripción / meta</label><input id="h-desc" value="${esc(h.description || h.goal)}"/></div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-accent" onclick="saveEditHabit('${id}')">Guardar</button>
    </div>`);
}

function saveEditHabit(id) {
  const h = state.habits.find(h => h.id === id);
  if (!h) return;
  const name = document.getElementById('h-name').value.trim();
  if (!name) return;
  h.name        = name;
  h.description = document.getElementById('h-desc').value.trim();
  h.goal        = h.description;
  h.updatedAt   = nowISO();
  save(); closeModal(); render();
}

function setHabitStatus(id, status) {
  const h = state.habits.find(h => h.id === id);
  if (!h) return;
  h.status    = status;
  h.active    = status === 'active';
  h.updatedAt = nowISO();
  save();
  if (status === 'active') syncHabitTasks();
  render();
}

function showModal(html) {
  document.getElementById('modal-content').innerHTML = html;
  document.getElementById('modal').classList.add('open');
}

function closeModal() {
  document.getElementById('modal').classList.remove('open');
}

// ─── EXPORT / IMPORT ─────────────────────────────────────────────────────────

function exportJSON() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `tracker-${today()}.json`;
  a.click();
}

function exportSummary() {
  const sp      = currentSprint();
  const tasks   = state.tasks.filter(t => t.sprintId === state.currentSprintId && t.status !== 'deleted');
  const done    = tasks.filter(t => t.status === 'done');
  const pending = tasks.filter(t => t.status !== 'done');

  const activeTasks = state.tasks.filter(t => t.status !== 'deleted');
  const globalDone  = activeTasks.filter(t => t.status === 'done').length;
  const globalTotal = activeTasks.length;

  const habits = state.habits.map(h => {
    const pct = Math.round((getLast14(h).filter(Boolean).length / 14) * 100);
    return `- ${h.name}: ${pct}% cumplimiento, racha ${getStreak(h)} días`;
  }).join('\n');

  const allSprints = state.sprints.filter(s => s.closed).map(s => {
    const t = state.tasks.filter(x => x.sprintId === s.id && x.status !== 'deleted');
    const d = t.filter(x => x.status === 'done').length;
    return `- ${s.id} (${s.range}): ${d}/${t.length} completadas`;
  }).join('\n');

  const categoryStats = ['trabajo','aprendizaje','personal','hábito'].map(cat => {
    const catTasks = activeTasks.filter(t => t.category === cat);
    const catDone  = catTasks.filter(t => t.status === 'done').length;
    const catPct   = catTasks.length ? Math.round((catDone / catTasks.length) * 100) : 0;
    return `- ${cat}: ${catPct}% (${catDone}/${catTasks.length})`;
  }).join('\n');

  const text = `# ANÁLISIS DE PRODUCTIVIDAD — ${today()}
Generado: ${nowISO()}

## Sprint actual: ${state.currentSprintId}
Rango: ${sp.range}
Completadas: ${done.length} | Pendientes: ${pending.length}

### Pendientes:
${pending.map(t => `- [${t.priority.toUpperCase()}] ${t.title} (vence: ${t.due || 'sin fecha'})`).join('\n') || 'ninguna'}

### Completadas este sprint:
${done.map(t => `- ${t.title}`).join('\n') || 'ninguna'}

## Hábitos (últimos 14 días):
${habits || 'sin hábitos registrados'}

## Historial de sprints:
${allSprints || 'sin sprints cerrados'}

## Estadísticas globales:
- Total tareas activas: ${globalTotal}
- Completadas: ${globalDone}
- Tasa global: ${globalTotal ? Math.round((globalDone/globalTotal)*100) : 0}%

## Cumplimiento por categoría:
${categoryStats}

## Preguntas sugeridas para Claude:
- ¿En qué categorías tengo mayor tasa de rollover?
- ¿Mis rachas de hábitos correlacionan con el % de tareas completadas?
- ¿Qué prioridades completo más consistentemente?
`;
  const blob = new Blob([text], { type: 'text/plain' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `reporte-${today()}.txt`;
  a.click();
}

function importJSON() { document.getElementById('import-input').click(); }

function handleImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const imported = JSON.parse(ev.target.result);
      if (confirm('¿Reemplazar todos los datos actuales con el archivo importado?')) {
        state = migrateSchema(imported);
        save(); render();
      }
    } catch { alert('Archivo JSON inválido.'); }
  };
  reader.readAsText(file);
}

// ─── TABS ─────────────────────────────────────────────────────────────────────

function switchTab(t) {
  document.querySelectorAll('.nav-tab').forEach((el, i) => {
    el.classList.toggle('active', ['kanban','history','habits','stats','epics','backlog'][i] === t);
  });
  document.querySelectorAll('.section').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-'+t).classList.add('active');
}

// ─── POMODORO ─────────────────────────────────────────────────────────────────

const Pomodoro = (() => {
  const PHASES = [
    { label: 'FOCO',          mins: 25, isBreak: false },
    { label: 'DESCANSO',      mins:  5, isBreak: true  },
    { label: 'FOCO',          mins: 25, isBreak: false },
    { label: 'DESCANSO',      mins:  5, isBreak: true  },
    { label: 'FOCO',          mins: 25, isBreak: false },
    { label: 'DESCANSO',      mins:  5, isBreak: true  },
    { label: 'FOCO',          mins: 25, isBreak: false },
    { label: 'DESCANSO LARGO',mins: 15, isBreak: true  },
  ];

  let _idx      = 0;
  let _secs     = PHASES[0].mins * 60;
  let _running  = false;
  let _timer    = null;
  let _pomCount = 0;

  function _phase() { return PHASES[_idx % PHASES.length]; }

  function toggle() { _running ? _pause() : _start(); }

  function _start() {
    if (_running) return;
    _running = true;
    _timer   = setInterval(_tick, 1000);
    _updateControls();
  }

  function _pause() {
    _running = false;
    clearInterval(_timer);
    _timer = null;
    _updateControls();
  }

  function reset() {
    _pause();
    _secs = _phase().mins * 60;
    _updateTimer();
    _updateControls();
  }

  function skip() { _pause(); _advance(); }

  function _tick() {
    if (_secs > 0) { _secs--; _updateTimer(); }
    else _onEnd();
  }

  function _onEnd() {
    _pause();
    const p = _phase();
    if (!p.isBreak) {
      _pomCount++;
      _updateDots();
      if (Notification.permission === 'granted') {
        new Notification('🍅 ¡Pomodoro completo!', {
          body: '25 minutos de foco. ¿Cómo va la tarea?',
          tag:  'pom-done',
        });
      }
      const doing = state.tasks.filter(t => t.sprintId === state.currentSprintId && t.status === 'doing');
      if (doing.length) openCheckInModal(doing);
    } else {
      if (Notification.permission === 'granted') {
        new Notification('☕ Descanso terminado', {
          body: '¡Listo para otro Pomodoro!',
          tag:  'pom-break',
        });
      }
    }
    _advance();
  }

  function _advance() {
    _idx  = (_idx + 1) % PHASES.length;
    _secs = _phase().mins * 60;
    _renderAll();
  }

  function _fmt(s) {
    return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
  }

  function _updateTimer() {
    const el = document.getElementById('pom-time');
    if (el) el.textContent = _fmt(_secs);
    document.title = _running ? `${_fmt(_secs)} · Tracker` : 'Tracker Personal';
  }

  function _updateControls() {
    const btn = document.getElementById('pom-toggle');
    if (btn) btn.textContent = _running ? '⏸' : '▶';
    const wrap = document.getElementById('pom-inline');
    if (wrap) wrap.classList.toggle('pom-running', _running);
  }

  function _updateDots() {
    const el = document.getElementById('pom-dots');
    if (!el) return;
    el.innerHTML = Array.from({length:4}, (_,i) =>
      `<span class="pom-dot ${i < (_pomCount % 4) ? 'filled' : ''}"></span>`
    ).join('');
  }

  function _renderAll() {
    _updateTimer();
    _updateControls();
    _updateDots();
    const ph = document.getElementById('pom-phase');
    if (ph) {
      const p = _phase();
      ph.textContent = p.label;
      ph.className   = `pom-phase-label ${p.isBreak ? 'break' : 'focus'}`;
    }
  }

  function updateTasks() {
    const sel = document.getElementById('pom-task');
    if (!sel) return;
    const doing   = state.tasks.filter(t => t.sprintId === state.currentSprintId && t.status === 'doing');
    const current = sel.value;
    sel.innerHTML  = doing.length
      ? `<option value="">— ninguna específica —</option>` + doing.map(t => `<option value="${t.id}">${t.title}</option>`).join('')
      : `<option value="">Sin tareas en progreso</option>`;
    if (current && doing.find(t => t.id === current)) sel.value = current;
  }

  return { toggle, reset, skip, updateTasks };
})();

// ─── CHECK-IN MODAL ───────────────────────────────────────────────────────────

function openCheckInModal(doingTasks) {
  const now   = new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  const items = doingTasks.map(t => `
    <div class="checkin-item" data-id="${t.id}">
      <div class="checkin-title">${t.title}</div>
      <div class="checkin-actions">
        <button class="btn btn-accent" onclick="respondCheckIn('${t.id}', true)">✓ completar</button>
        <button class="btn" onclick="respondCheckIn('${t.id}', false)">⏸ seguir</button>
      </div>
    </div>`).join('');
  showModal(`<div class="modal-title">⏱ Check-in — ${now}</div>
    <div style="font-size:11px;color:var(--text3);margin-bottom:16px">¿Cómo van estas tareas?</div>
    <div class="checkin-list">${items}</div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cerrar</button>
    </div>`);
}

function respondCheckIn(id, done) {
  if (done) moveTask(id, 'done');
  const item = document.querySelector(`.checkin-item[data-id="${id}"]`);
  if (item) item.remove();
  if (!document.querySelector('.checkin-item')) closeModal();
}

// ─── ÉPICAS ───────────────────────────────────────────────────────────────────

const EPIC_COLORS = ['#5a9ef0','#4ade9a','#f0a030','#f05454','#c084fc','#fb923c','#34d399','#f472b6'];

function renderEpics() {
  const el = document.getElementById('epics-grid');
  if (!el) return;
  if (!state.epics || !state.epics.length) {
    el.innerHTML = '<div style="color:var(--text3);font-size:13px;padding:40px 0;text-align:center;">Sin épicas. Creá una para agrupar tareas relacionadas.</div>';
    return;
  }
  el.innerHTML = state.epics.map(e => epicCardHTML(e)).join('');
}

function epicCardHTML(epic) {
  const tasks      = state.tasks.filter(t => t.epicId === epic.id && t.status !== 'deleted');
  const doneCnt    = tasks.filter(t => t.status === 'done').length;
  const total      = tasks.length;
  const pct        = total ? Math.round((doneCnt / total) * 100) : 0;
  const fill       = pct >= 70 ? 'var(--accent)' : pct >= 40 ? 'var(--amber)' : 'var(--red)';
  const doing      = tasks.filter(t => t.status === 'doing');
  const todo       = tasks.filter(t => t.status === 'todo');
  const doneT      = tasks.filter(t => t.status === 'done');
  const rows = [
    ...doing.map(t => `<div class="epic-task-row doing">▶ ${t.title}</div>`),
    ...todo.map(t  => `<div class="epic-task-row todo">· ${t.title}</div>`),
    ...doneT.map(t => `<div class="epic-task-row done">✓ ${t.title}</div>`),
  ].join('');
  const closedCls = epic.status === 'done' ? 'epic-closed' : '';
  return `<div class="epic-card ${closedCls}" style="border-top:3px solid ${epic.color}">
    <div class="epic-head">
      <div class="epic-title">${epic.title}</div>
      <div class="epic-pct" style="color:${fill}">${pct}%</div>
    </div>
    ${epic.description ? `<div class="epic-desc">${epic.description}</div>` : ''}
    <div class="epic-bar"><div class="epic-bar-fill" style="width:${pct}%;background:${epic.color}"></div></div>
    <div class="epic-stats">${doneCnt}/${total} tareas · ${doing.length} en progreso</div>
    ${rows ? `<div class="epic-tasks">${rows}</div>` : ''}
    <div class="epic-actions">
      ${epic.status !== 'done' ? `<button class="task-btn primary" onclick="openAddTask('todo','${epic.id}')">+ tarea</button>` : ''}
      <button class="task-btn" onclick="openEditEpic('${epic.id}')">✎ editar</button>
      ${epic.status !== 'done' ? `<button class="task-btn cal" onclick="closeEpic('${epic.id}')">✓ cerrar</button>` : ''}
      <button class="task-btn danger" onclick="deleteEpic('${epic.id}')">✕</button>
    </div>
  </div>`;
}

function openAddEpic() {
  const picker = EPIC_COLORS.map((c, i) =>
    `<div class="color-opt ${i === 0 ? 'selected' : ''}" style="background:${c}" onclick="selectEpicColor('${c}',this)"></div>`
  ).join('');
  showModal(`<div class="modal-title">Nueva épica</div>
    <div class="field"><label>Título</label><input id="e-title" placeholder="Ej: Lanzamiento MVP" autofocus/></div>
    <div class="field"><label>Descripción</label><textarea id="e-desc" placeholder="Objetivo principal"></textarea></div>
    <div class="field"><label>Color</label><div class="color-picker">${picker}</div><input type="hidden" id="e-color" value="${EPIC_COLORS[0]}"/></div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-accent" onclick="addEpic()">Crear épica</button>
    </div>`);
}

function selectEpicColor(color, el) {
  document.querySelectorAll('.color-opt').forEach(d => d.classList.remove('selected'));
  el.classList.add('selected');
  document.getElementById('e-color').value = color;
}

function addEpic() {
  const title = document.getElementById('e-title').value.trim();
  if (!title) return;
  if (!state.epics) state.epics = [];
  state.epics.push({ id: uid(), title, description: document.getElementById('e-desc').value.trim(), color: document.getElementById('e-color').value, status: 'active', createdAt: today(), updatedAt: nowISO() });
  save(); closeModal(); renderEpics();
}

function openEditEpic(id) {
  const e = state.epics.find(e => e.id === id);
  if (!e) return;
  const esc    = s => (s || '').replace(/"/g, '&quot;');
  const picker = EPIC_COLORS.map(c =>
    `<div class="color-opt ${e.color === c ? 'selected' : ''}" style="background:${c}" onclick="selectEpicColor('${c}',this)"></div>`
  ).join('');
  showModal(`<div class="modal-title">Editar épica</div>
    <div class="field"><label>Título</label><input id="e-title" value="${esc(e.title)}" autofocus/></div>
    <div class="field"><label>Descripción</label><textarea id="e-desc">${esc(e.description)}</textarea></div>
    <div class="field"><label>Color</label><div class="color-picker">${picker}</div><input type="hidden" id="e-color" value="${e.color}"/></div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-accent" onclick="saveEditEpic('${id}')">Guardar</button>
    </div>`);
}

function saveEditEpic(id) {
  const e = state.epics.find(e => e.id === id);
  if (!e) return;
  const title = document.getElementById('e-title').value.trim();
  if (!title) return;
  e.title       = title;
  e.description = document.getElementById('e-desc').value.trim();
  e.color       = document.getElementById('e-color').value;
  e.updatedAt   = nowISO();
  save(); closeModal(); render();
}

function closeEpic(id) {
  if (!confirm('¿Marcar esta épica como completada?')) return;
  const e = state.epics.find(e => e.id === id);
  if (!e) return;
  e.status    = 'done';
  e.updatedAt = nowISO();
  save(); renderEpics();
}

function deleteEpic(id) {
  if (!confirm('¿Eliminar esta épica? Las tareas asociadas quedarán sin épica.')) return;
  state.tasks.filter(t => t.epicId === id).forEach(t => { t.epicId = null; t.updatedAt = nowISO(); });
  state.epics = state.epics.filter(e => e.id !== id);
  save(); render();
}

// ─── BACKLOG ──────────────────────────────────────────────────────────────────

let _backlogFilter = 'all';

function renderBacklog() {
  const el = document.getElementById('backlog-list');
  if (!el) return;
  let tasks = state.tasks.filter(t => !t.sprintId && t.status !== 'deleted');
  if (_backlogFilter === 'unassigned') tasks = tasks.filter(t => !t.targetSprintId);
  if (_backlogFilter === 'scheduled')  tasks = tasks.filter(t =>  t.targetSprintId);
  if (!tasks.length) {
    el.innerHTML = '<div class="empty-backlog">El backlog está vacío. Agregá tareas que no pertenecen al sprint actual.</div>';
    return;
  }
  el.innerHTML = tasks.map(t => backlogTaskHTML(t)).join('');
}

function backlogTaskHTML(t) {
  const epic     = t.epicId ? (state.epics || []).find(e => e.id === t.epicId) : null;
  const priClass = { high:'pri-high', medium:'pri-medium', low:'pri-low' }[t.priority] || 'pri-medium';
  const weekLabel = t.targetSprintId
    ? `<span class="backlog-week scheduled">📅 ${t.targetSprintId}</span>`
    : `<span class="backlog-week">— sin semana</span>`;
  return `<div class="backlog-task">
    <div class="backlog-task-left">
      <div class="backlog-title">${t.title}</div>
      <div class="backlog-meta">
        <span class="tag tag-cat">${t.category}</span>
        ${epic ? `<span class="tag tag-epic" style="background:${epic.color}22;color:${epic.color};border-color:${epic.color}55">${epic.title}</span>` : ''}
        ${t.due ? `<span class="tag-date">${t.due}</span>` : ''}
        ${weekLabel}
      </div>
    </div>
    <div class="backlog-task-right">
      <div class="pri-dot ${priClass}"></div>
      <button class="task-btn primary" onclick="assignToCurrentSprint('${t.id}')">→ sprint</button>
      <button class="task-btn cal" onclick="openScheduleTask('${t.id}')">📅 programar</button>
      <button class="task-btn" onclick="openEditTask('${t.id}')">✎</button>
      <button class="task-btn danger" onclick="deleteTask('${t.id}')">✕</button>
    </div>
  </div>`;
}

function filterBacklog(filter, el) {
  _backlogFilter = filter;
  document.querySelectorAll('.backlog-filters .sprint-pill').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  renderBacklog();
}

function openAddBacklogTask() {
  const activeEpics = (state.epics || []).filter(e => e.status !== 'done');
  const epicOpts    = activeEpics.map(e => `<option value="${e.id}">${e.title}</option>`).join('');
  const epicField   = activeEpics.length
    ? `<div class="field"><label>Épica (opcional)</label><select id="f-epic"><option value="">— sin épica —</option>${epicOpts}</select></div>`
    : '';
  const weekOpts = getUpcomingWeeks(6).map(w => `<option value="${w.id}">${w.id} · ${w.range}</option>`).join('');
  showModal(`<div class="modal-title">Nueva tarea — Backlog</div>
    <div class="field"><label>Título</label><input id="f-title" placeholder="Nombre claro y accionable" autofocus/></div>
    <div class="field"><label>Descripción de tarea</label><input id="f-step" placeholder="Detalle opcional de la tarea"/></div>
    <div class="field"><label>Categoría</label><select id="f-cat">
      <option>trabajo</option><option>aprendizaje</option><option>hábito</option><option>personal</option>
    </select></div>
    <div class="field"><label>Prioridad</label><select id="f-pri">
      <option value="high">Alta</option><option value="medium" selected>Media</option><option value="low">Baja</option>
    </select></div>
    <div class="field"><label>Fecha límite</label><input type="date" id="f-due"/></div>
    ${epicField}
    <div class="field"><label>Programar para sprint (opcional)</label>
      <select id="f-target-sprint"><option value="">— sin programar —</option>${weekOpts}</select>
    </div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-accent" onclick="addBacklogTask()">Agregar al backlog</button>
    </div>`);
}

function addBacklogTask() {
  const title = document.getElementById('f-title').value.trim();
  if (!title) return;
  const epicEl   = document.getElementById('f-epic');
  const targetEl = document.getElementById('f-target-sprint');
  state.tasks.push({
    id: uid(), title,
    firstStep: document.getElementById('f-step').value.trim(),
    category:  document.getElementById('f-cat').value,
    priority:  document.getElementById('f-pri').value,
    due:       document.getElementById('f-due').value,
    status: 'todo', sprintId: null,
    calendarEventId: null, calendarEventLink: null, checkInEventIds: [],
    epicId:          epicEl  ? (epicEl.value  || null) : null,
    habitId:         null,
    targetSprintId:  targetEl ? (targetEl.value || null) : null,
    createdAt: today(), updatedAt: nowISO(), completedAt: null, deletedAt: null
  });
  save(); closeModal(); render(); switchTab('backlog');
}

function assignToCurrentSprint(id) {
  const t = state.tasks.find(t => t.id === id);
  if (!t) return;
  t.sprintId       = state.currentSprintId;
  t.targetSprintId = null;
  t.updatedAt      = nowISO();
  save(); render();
}

function openScheduleTask(id) {
  const t = state.tasks.find(t => t.id === id);
  if (!t) return;
  const weekOpts = getUpcomingWeeks(6).map(w =>
    `<option value="${w.id}" ${t.targetSprintId === w.id ? 'selected' : ''}>${w.id} · ${w.range}</option>`
  ).join('');
  showModal(`<div class="modal-title">Programar para sprint</div>
    <div style="font-size:12px;color:var(--text2);margin-bottom:16px;line-height:1.5">${t.title}</div>
    <div class="field"><label>Semana destino</label>
      <select id="f-target-sprint">
        <option value="">— sin programar —</option>
        ${weekOpts}
      </select>
    </div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-accent" onclick="saveScheduleTask('${id}')">Guardar</button>
    </div>`);
}

function saveScheduleTask(id) {
  const t  = state.tasks.find(t => t.id === id);
  if (!t) return;
  const el = document.getElementById('f-target-sprint');
  t.targetSprintId = el ? (el.value || null) : null;
  t.updatedAt      = nowISO();
  save(); closeModal(); renderBacklog();
}

// ─── KEYBOARD ─────────────────────────────────────────────────────────────────

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
  if (e.key === 'n' && !e.ctrlKey && !e.metaKey && document.activeElement.tagName !== 'INPUT') openAddTask('todo');
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && Reminders.hasPendingCheckIn()) {
    Reminders.clearPendingCheckIn();
    const doing = state.tasks.filter(t => t.sprintId === state.currentSprintId && t.status === 'doing');
    if (doing.length) openCheckInModal(doing);
  }
});


// ─── INIT ─────────────────────────────────────────────────────────────────────

load();

/*
 * Todo List — DOM wiring. All user content is rendered with textContent;
 * no innerHTML, eval, or inline event handlers are used.
 */
(function () {
  'use strict';

  var Core = window.TodoCore;
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var PRIORITY_LABEL = { low: 'Low', medium: 'Medium', high: 'High' };

  var storage = getStorage();
  var state = {
    tasks: [],
    filter: 'all',
    query: '',
    sort: 'newest',
    editingId: null,
    lastAddedId: null
  };

  // ---------- element lookup ----------
  var $ = function (id) { return document.getElementById(id); };
  var els = {
    form: $('task-form'),
    title: $('task-title'),
    description: $('task-description'),
    priority: $('task-priority'),
    due: $('task-due'),
    list: $('task-list'),
    empty: $('empty-state'),
    emptyTitle: $('empty-title'),
    emptyText: $('empty-text'),
    emptyAction: $('empty-action'),
    search: $('search-input'),
    sort: $('sort-select'),
    resultCount: $('result-count'),
    statTotal: $('stat-total'),
    statCompleted: $('stat-completed'),
    statPending: $('stat-pending'),
    progressText: $('progress-text'),
    progressBar: $('progress-bar'),
    progressFill: $('progress-fill'),
    sampleBtn: $('sample-btn'),
    clearBtn: $('clear-btn'),
    toastRegion: $('toast-region'),
    alert: $('storage-alert'),
    alertText: $('storage-alert-text'),
    greeting: $('greeting'),
    todayLabel: $('today-label'),
    editDialog: $('edit-dialog'),
    editForm: $('edit-form'),
    editTitle: $('edit-title-input'),
    editDescription: $('edit-description'),
    editPriority: $('edit-priority'),
    editDue: $('edit-due'),
    confirmDialog: $('confirm-dialog'),
    confirmTitle: $('confirm-title'),
    confirmText: $('confirm-text'),
    confirmOk: $('confirm-ok')
  };

  // ---------- storage ----------
  function getStorage() {
    try {
      var s = window.localStorage;
      var probe = '__plodphai_probe__';
      s.setItem(probe, '1');
      s.removeItem(probe);
      return s;
    } catch (e) {
      // Fallback keeps the app usable (non-persistent) when storage is blocked.
      var mem = {};
      return {
        unavailable: true,
        getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
        setItem: function (k, v) { mem[k] = String(v); },
        removeItem: function (k) { delete mem[k]; }
      };
    }
  }

  function persist() {
    if (!Core.saveTasks(storage, state.tasks)) {
      showAlert('Your changes could not be saved. Browser storage may be full or disabled.');
      toast('Could not save changes to browser storage.', 'error');
    }
  }

  function showAlert(message) {
    els.alertText.textContent = message;
    els.alert.hidden = false;
  }

  // ---------- small DOM helpers ----------
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function icon(name) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    var use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', '#i-' + name);
    svg.appendChild(use);
    return svg;
  }

  function formatDate(iso) {
    if (!iso) return '';
    var parts = iso.split('-').map(Number);
    var d = new Date(parts[0], parts[1] - 1, parts[2]);
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function formatCreated(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime()) || d.getTime() === 0) return '';
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }

  // ---------- toasts ----------
  function toast(message, kind) {
    var item = el('div', 'toast toast-' + (kind || 'success'));
    item.appendChild(icon(kind === 'error' ? 'alert' : kind === 'info' ? 'trash' : 'check'));
    item.appendChild(el('span', null, message));
    els.toastRegion.appendChild(item);
    window.setTimeout(function () {
      item.classList.add('is-leaving');
      window.setTimeout(function () { item.remove(); }, 200);
    }, 3200);
  }

  // ---------- confirmation ----------
  function confirmAction(opts) {
    var dialog = els.confirmDialog;
    if (typeof dialog.showModal !== 'function') {
      return Promise.resolve(window.confirm(opts.title + '\n\n' + opts.text));
    }
    els.confirmTitle.textContent = opts.title;
    els.confirmText.textContent = opts.text;
    els.confirmOk.textContent = opts.confirmLabel || 'Delete';
    dialog.returnValue = '';
    return new Promise(function (resolve) {
      dialog.addEventListener('close', function onClose() {
        dialog.removeEventListener('close', onClose);
        resolve(dialog.returnValue === 'confirm');
      });
      dialog.showModal();
    });
  }

  // ---------- form validation display ----------
  function setFieldError(input, message) {
    var err = document.getElementById(input.id + '-error');
    if (err) err.textContent = message || '';
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }

  function showErrors(fields, errors) {
    var first = null;
    Object.keys(fields).forEach(function (key) {
      setFieldError(fields[key], errors[key]);
      if (errors[key] && !first) first = fields[key];
    });
    if (first) first.focus();
  }

  function readForm(f) {
    return {
      title: f.title.value,
      description: f.description.value,
      priority: f.priority.value,
      dueDate: f.dueDate.value
    };
  }

  // ---------- rendering ----------
  function renderStats() {
    var s = Core.summarize(state.tasks);
    els.statTotal.textContent = String(s.total);
    els.statCompleted.textContent = String(s.completed);
    els.statPending.textContent = String(s.pending);
    document.querySelectorAll('[data-count]').forEach(function (node) {
      node.textContent = String(s[node.getAttribute('data-count')]);
    });
    var pct = s.total ? Math.round((s.completed / s.total) * 100) : 0;
    els.progressText.textContent = pct + '%';
    els.progressBar.setAttribute('aria-valuenow', String(pct));
    els.progressFill.style.width = pct + '%';
  }

  function renderFilterButtons() {
    document.querySelectorAll('[data-filter]').forEach(function (btn) {
      var active = btn.getAttribute('data-filter') === state.filter;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function buildTaskItem(task) {
    var li = el('li', 'task-item priority-' + task.priority + (task.completed ? ' is-done' : ''));
    li.setAttribute('data-id', task.id);
    if (task.id === state.lastAddedId) li.classList.add('is-new');

    var check = el('button', 'check-btn');
    check.type = 'button';
    check.setAttribute('data-action', 'toggle');
    check.setAttribute('aria-pressed', task.completed ? 'true' : 'false');
    check.setAttribute('aria-label', (task.completed ? 'Mark as pending: ' : 'Mark as completed: ') + task.title);
    check.appendChild(icon('check'));
    li.appendChild(check);

    var body = el('div', 'task-body');
    body.appendChild(el('h3', 'task-title', task.title));
    if (task.description) body.appendChild(el('p', 'task-desc', task.description));

    var meta = el('div', 'task-meta');
    var status = el('span', 'badge ' + (task.completed ? 'badge-done' : 'badge-pending'));
    status.appendChild(icon(task.completed ? 'check-circle' : 'clock'));
    status.appendChild(document.createTextNode(task.completed ? 'Completed' : 'Pending'));
    meta.appendChild(status);

    var prio = el('span', 'badge badge-priority badge-' + task.priority);
    prio.appendChild(icon('flag'));
    prio.appendChild(document.createTextNode(PRIORITY_LABEL[task.priority] + ' priority'));
    meta.appendChild(prio);

    if (task.dueDate) {
      var dueState = Core.dueStatus(task, new Date());
      var due = el('span', 'badge badge-due' + (dueState ? ' due-' + dueState : ''));
      due.appendChild(icon('calendar'));
      var dueText = 'Due ' + formatDate(task.dueDate);
      if (dueState === 'overdue') dueText += ' · Overdue';
      else if (dueState === 'today') dueText += ' · Today';
      due.appendChild(document.createTextNode(dueText));
      meta.appendChild(due);
    }

    var created = formatCreated(task.createdAt);
    if (created) meta.appendChild(el('span', 'meta-created', 'Added ' + created));
    body.appendChild(meta);
    li.appendChild(body);

    var actions = el('div', 'task-actions');
    var edit = el('button', 'icon-btn');
    edit.type = 'button';
    edit.setAttribute('data-action', 'edit');
    edit.setAttribute('aria-label', 'Edit task: ' + task.title);
    edit.title = 'Edit';
    edit.appendChild(icon('edit'));
    var del = el('button', 'icon-btn icon-btn-danger');
    del.type = 'button';
    del.setAttribute('data-action', 'delete');
    del.setAttribute('aria-label', 'Delete task: ' + task.title);
    del.title = 'Delete';
    del.appendChild(icon('trash'));
    actions.appendChild(edit);
    actions.appendChild(del);
    li.appendChild(actions);
    return li;
  }

  function renderList() {
    var visible = Core.sortTasks(Core.filterTasks(state.tasks, state.filter, state.query), state.sort);
    var fragment = document.createDocumentFragment();
    visible.forEach(function (t) { fragment.appendChild(buildTaskItem(t)); });
    els.list.replaceChildren(fragment);
    state.lastAddedId = null;

    els.resultCount.textContent = state.tasks.length
      ? '(' + visible.length + ' of ' + state.tasks.length + ')'
      : '';

    var isEmpty = visible.length === 0;
    els.empty.hidden = !isEmpty;
    els.list.hidden = isEmpty;
    if (!isEmpty) return;

    if (state.tasks.length === 0) {
      els.emptyTitle.textContent = 'No tasks yet';
      els.emptyText.textContent = 'Add your first task above, or load a few sample tasks to explore.';
      els.emptyAction.textContent = 'Load sample tasks';
      els.emptyAction.setAttribute('data-empty', 'sample');
    } else {
      els.emptyTitle.textContent = 'No matching tasks';
      els.emptyText.textContent = state.query
        ? 'Nothing matches “' + state.query.trim() + '” in this view. Try a different search or filter.'
        : (state.filter === 'completed' ? 'You have not completed any tasks yet.' : 'Everything is done. Nice work!');
      els.emptyAction.textContent = 'Show all tasks';
      els.emptyAction.setAttribute('data-empty', 'reset');
    }
  }

  function render() {
    renderStats();
    renderFilterButtons();
    renderList();
  }

  // ---------- actions ----------
  function addTask(evt) {
    evt.preventDefault();
    var fields = { title: els.title, description: els.description, dueDate: els.due };
    var result = Core.createTask(readForm(els.form));
    if (!result.ok) {
      showErrors(fields, result.errors);
      toast('Please fix the highlighted fields.', 'error');
      return;
    }
    showErrors(fields, {});
    state.tasks = state.tasks.concat(result.task);
    state.lastAddedId = result.task.id;
    persist();
    els.form.reset();
    els.priority.value = 'medium';
    render();
    els.title.focus();
    toast('Task added: ' + result.task.title);
  }

  function findTask(id) {
    for (var i = 0; i < state.tasks.length; i++) {
      if (state.tasks[i].id === id) return state.tasks[i];
    }
    return null;
  }

  function toggle(id) {
    state.tasks = Core.toggleTask(state.tasks, id);
    persist();
    render();
    var task = findTask(id);
    var btn = els.list.querySelector('[data-id="' + cssEscape(id) + '"] [data-action="toggle"]');
    if (btn) btn.focus();
    if (task) toast(task.completed ? 'Marked as completed.' : 'Marked as pending.');
  }

  function openEdit(id) {
    var task = findTask(id);
    if (!task) return;
    state.editingId = id;
    els.editTitle.value = task.title;
    els.editDescription.value = task.description || '';
    els.editPriority.value = task.priority;
    els.editDue.value = task.dueDate || '';
    showErrors({ title: els.editTitle, description: els.editDescription, dueDate: els.editDue }, {});
    if (typeof els.editDialog.showModal === 'function') {
      els.editDialog.showModal();
    } else {
      els.editDialog.setAttribute('open', '');
    }
    els.editTitle.focus();
  }

  function closeEdit() {
    if (typeof els.editDialog.close === 'function') els.editDialog.close();
    else els.editDialog.removeAttribute('open');
  }

  function saveEdit(evt) {
    evt.preventDefault();
    var task = findTask(state.editingId);
    if (!task) { closeEdit(); return; }
    var fields = { title: els.editTitle, description: els.editDescription, dueDate: els.editDue };
    var result = Core.updateTask(task, readForm(els.editForm));
    if (!result.ok) {
      showErrors(fields, result.errors);
      return;
    }
    state.tasks = Core.replaceTask(state.tasks, result.task);
    persist();
    closeEdit();
    render();
    toast('Task updated.');
  }

  function remove(id) {
    var task = findTask(id);
    if (!task) return;
    confirmAction({
      title: 'Delete task?',
      text: '“' + task.title + '” will be permanently removed.',
      confirmLabel: 'Delete task'
    }).then(function (ok) {
      if (!ok) return;
      state.tasks = Core.removeTask(state.tasks, id);
      persist();
      render();
      els.list.focus();
      toast('Task deleted.', 'info');
    });
  }

  function clearAll() {
    if (state.tasks.length === 0) {
      toast('There are no tasks to clear.', 'info');
      return;
    }
    confirmAction({
      title: 'Clear all tasks?',
      text: 'All ' + state.tasks.length + ' tasks will be removed from this browser. This cannot be undone.',
      confirmLabel: 'Clear all'
    }).then(function (ok) {
      if (!ok) return;
      state.tasks = [];
      persist();
      render();
      toast('All tasks cleared.', 'info');
    });
  }

  function loadSamples() {
    var result = Core.addSampleTasks(state.tasks);
    if (result.added === 0) {
      toast('Sample tasks are already loaded.', 'info');
      return;
    }
    state.tasks = result.tasks;
    persist();
    render();
    toast('Added ' + result.added + ' sample task' + (result.added === 1 ? '' : 's') + '.');
  }

  function setFilter(value) {
    state.filter = value;
    render();
  }

  function cssEscape(value) {
    return window.CSS && typeof window.CSS.escape === 'function'
      ? window.CSS.escape(value)
      : String(value).replace(/["\\]/g, '\\$&');
  }

  // ---------- header ----------
  function renderHeader() {
    var now = new Date();
    var h = now.getHours();
    els.greeting.textContent = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    els.todayLabel.textContent = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  // ---------- events ----------
  function bind() {
    els.form.addEventListener('submit', addTask);
    els.title.addEventListener('input', function () {
      if (els.title.value.trim()) setFieldError(els.title, '');
    });

    els.list.setAttribute('tabindex', '-1');
    els.list.addEventListener('click', function (evt) {
      var btn = evt.target.closest('button[data-action]');
      if (!btn) return;
      var item = btn.closest('[data-id]');
      if (!item) return;
      var id = item.getAttribute('data-id');
      var action = btn.getAttribute('data-action');
      if (action === 'toggle') toggle(id);
      else if (action === 'edit') openEdit(id);
      else if (action === 'delete') remove(id);
    });

    document.querySelectorAll('[data-filter]').forEach(function (btn) {
      btn.addEventListener('click', function () { setFilter(btn.getAttribute('data-filter')); });
    });

    els.search.addEventListener('input', function () {
      state.query = els.search.value;
      renderList();
    });

    els.sort.addEventListener('change', function () {
      state.sort = els.sort.value;
      renderList();
    });

    els.sampleBtn.addEventListener('click', loadSamples);
    els.clearBtn.addEventListener('click', clearAll);
    els.emptyAction.addEventListener('click', function () {
      if (els.emptyAction.getAttribute('data-empty') === 'reset') {
        state.query = '';
        els.search.value = '';
        setFilter('all');
      } else {
        loadSamples();
      }
    });

    els.editForm.addEventListener('submit', saveEdit);
    els.editDialog.querySelectorAll('[data-close]').forEach(function (btn) {
      btn.addEventListener('click', closeEdit);
    });
  }

  // ---------- init ----------
  function init() {
    renderHeader();
    var loaded = Core.loadTasks(storage);
    state.tasks = loaded.tasks;
    if (storage.unavailable) {
      showAlert('Browser storage is unavailable, so tasks will be lost when you close this page.');
    } else if (loaded.recovered) {
      showAlert('Some saved task data was unreadable and has been skipped.');
      persist();
    }
    bind();
    render();
    document.documentElement.setAttribute('data-ready', 'true');
  }

  init();
})();

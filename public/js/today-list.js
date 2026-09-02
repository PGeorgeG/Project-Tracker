document.addEventListener('DOMContentLoaded', function () {
  const menu = document.getElementById('todoContextMenu');
  if (!menu) return; // not on this page

  const addBtn = document.getElementById('ctxAddToday');
  const removeBtn = document.getElementById('ctxRemoveToday');
  let activeRow = null;

  function showMenu(x, y, row) {
    activeRow = row;
    const onToday = row.dataset.onToday === 'true';
    addBtn.style.display = onToday ? 'none' : 'block';
    removeBtn.style.display = onToday ? 'block' : 'none';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.style.display = 'block';
  }

  function hideMenu() {
    menu.style.display = 'none';
    activeRow = null;
  }

  document.querySelectorAll('.global-todo-row, .postit').forEach(function (row) {
    row.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      showMenu(e.clientX, e.clientY, row);
    });
  });

  // Touch has no right-click, so a long press on a row opens the same menu.
  // .postit wires up its own long-press (it needs to also cancel a
  // possible drag) and dispatches this same contextmenu event when it fires.
  const LONG_PRESS_MS = 550;
  const LONG_PRESS_MOVE_TOLERANCE = 10;
  document.querySelectorAll('.global-todo-row').forEach(function (row) {
    let pressTimer = null;
    let startX, startY;

    function cancelPress() {
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    }

    row.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'touch') return;
      startX = e.clientX;
      startY = e.clientY;
      pressTimer = setTimeout(function () {
        pressTimer = null;
        row.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true, cancelable: true, clientX: startX, clientY: startY
        }));
      }, LONG_PRESS_MS);
    });
    row.addEventListener('pointermove', function (e) {
      if (!pressTimer) return;
      if (Math.abs(e.clientX - startX) > LONG_PRESS_MOVE_TOLERANCE || Math.abs(e.clientY - startY) > LONG_PRESS_MOVE_TOLERANCE) cancelPress();
    });
    row.addEventListener('pointerup', cancelPress);
    row.addEventListener('pointercancel', cancelPress);
  });

  document.querySelectorAll('.row-kebab').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      const row = btn.closest('.global-todo-row');
      const rect = btn.getBoundingClientRect();
      showMenu(rect.left, rect.bottom + 4, row);
    });
  });

  function submitAction(path) {
    if (!activeRow) return;
    const projectId = activeRow.dataset.projectId;
    const todoId = activeRow.dataset.todoId;
    const kind = activeRow.dataset.type === 'alert' ? 'alerts' : 'todos';
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = '/projects/' + projectId + '/' + kind + '/' + todoId + path;
    const redirectInput = document.createElement('input');
    redirectInput.type = 'hidden';
    redirectInput.name = 'redirect_to';
    redirectInput.value = window.location.pathname;
    form.appendChild(redirectInput);
    document.body.appendChild(form);
    form.submit();
  }

  addBtn.addEventListener('click', function () { submitAction('/today'); });
  removeBtn.addEventListener('click', function () { submitAction('/today/remove'); });

  document.addEventListener('click', function (e) {
    if (menu.style.display === 'block' && !menu.contains(e.target) && !e.target.classList.contains('row-kebab')) {
      hideMenu();
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') hideMenu();
  });

  const copyBtn = document.getElementById('copyTodayListBtn');
  if (copyBtn) {
    copyBtn.addEventListener('click', function () {
      const rows = document.querySelectorAll('.today-list-row');
      const lines = Array.from(rows).map(function (r) {
        return '- ' + r.dataset.todoText + ' (' + r.dataset.projectName + ')';
      });
      const text = 'Project Tracker Todo List\n\n' + lines.join('\n');

      function fallbackCopy(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (e) { /* clipboard unavailable */ }
        document.body.removeChild(ta);
      }

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(function () { fallbackCopy(text); });
      } else {
        fallbackCopy(text);
      }

      const original = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      setTimeout(function () { copyBtn.textContent = original; }, 1500);
    });
  }
});

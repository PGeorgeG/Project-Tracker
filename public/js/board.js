document.addEventListener('DOMContentLoaded', function () {
  const canvas = document.getElementById('boardCanvas');
  if (!canvas) return;

  const csrfMeta = document.querySelector('meta[name="csrf-token"]');
  const csrfToken = csrfMeta ? csrfMeta.content : '';

  const DRAG_THRESHOLD = 4;
  const LONG_PRESS_MS = 550;
  let zTop = 10;

  canvas.querySelectorAll('.postit').forEach(function (note) {
    let dragging = false;
    let moved = false;
    let startX, startY, origLeft, origTop;
    let longPressTimer = null;

    function clearLongPress() {
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    }

    note.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return; // right-click opens the context menu instead
      if (e.target.closest('.postit-no-drag')) return;
      dragging = true;
      moved = false;
      startX = e.clientX;
      startY = e.clientY;
      origLeft = note.offsetLeft;
      origTop = note.offsetTop;
      note.setPointerCapture(e.pointerId);
      note.style.zIndex = ++zTop;
      note.classList.add('dragging');

      // Touch has no right-click, so a long press without much movement
      // opens the same "add to Today List" menu instead of starting a drag.
      if (e.pointerType === 'touch') {
        longPressTimer = setTimeout(function () {
          longPressTimer = null;
          if (moved) return;
          dragging = false;
          note.classList.remove('dragging');
          note.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true, cancelable: true, clientX: startX, clientY: startY
          }));
        }, LONG_PRESS_MS);
      }
    });

    note.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!moved && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
        moved = true;
        clearLongPress();
      }
      if (!moved) return;
      const maxLeft = canvas.clientWidth - note.offsetWidth;
      const maxTop = canvas.clientHeight - note.offsetHeight;
      note.style.left = Math.max(0, Math.min(maxLeft, origLeft + dx)) + 'px';
      note.style.top = Math.max(0, Math.min(maxTop, origTop + dy)) + 'px';
    });

    note.addEventListener('pointerup', function () {
      clearLongPress();
      if (!dragging) return;
      dragging = false;
      note.classList.remove('dragging');
      if (!moved) return;
      fetch('/todos/' + note.dataset.todoId + '/position', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'x=' + note.offsetLeft + '&y=' + note.offsetTop + '&_csrf=' + encodeURIComponent(csrfToken)
      });
    });
  });

  // Holding box: drag a waiting note out onto the canvas to give it a
  // position for the first time. Dropping outside the canvas leaves it
  // in the holding box untouched.
  document.querySelectorAll('.holding-note').forEach(function (note) {
    note.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      e.preventDefault();

      const ghost = note.cloneNode(true);
      ghost.classList.add('holding-note-ghost');
      ghost.style.position = 'fixed';
      ghost.style.left = (e.clientX - 20) + 'px';
      ghost.style.top = (e.clientY - 20) + 'px';
      ghost.style.pointerEvents = 'none';
      ghost.style.zIndex = 9999;
      document.body.appendChild(ghost);

      function onMove(ev) {
        ghost.style.left = (ev.clientX - 20) + 'px';
        ghost.style.top = (ev.clientY - 20) + 'px';
      }

      function onUp(ev) {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        ghost.remove();

        const dropEl = document.elementFromPoint(ev.clientX, ev.clientY);
        const dropCanvas = dropEl && dropEl.closest('#boardCanvas');
        if (!dropCanvas) return; // dropped outside the board — stays in the holding box

        const rect = dropCanvas.getBoundingClientRect();
        const x = Math.max(0, Math.round(ev.clientX - rect.left - 20));
        const y = Math.max(0, Math.round(ev.clientY - rect.top - 20));
        fetch('/todos/' + note.dataset.todoId + '/position', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'x=' + x + '&y=' + y + '&_csrf=' + encodeURIComponent(csrfToken)
        }).then(function () { window.location.reload(); });
      }

      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
  });

  canvas.querySelectorAll('.postit-toggle-form').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      const note = form.closest('.postit');
      fetch(form.action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: '_csrf=' + encodeURIComponent(csrfToken)
      }).then(function () {
        note.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
        note.style.opacity = '0';
        note.style.transform += ' scale(0.85)';
        setTimeout(function () { note.remove(); }, 200);
      });
    });
  });
});

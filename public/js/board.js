document.addEventListener('DOMContentLoaded', function () {
  const canvas = document.getElementById('boardCanvas');
  if (!canvas) return;

  const DRAG_THRESHOLD = 4;
  let zTop = 10;

  canvas.querySelectorAll('.postit').forEach(function (note) {
    let dragging = false;
    let moved = false;
    let startX, startY, origLeft, origTop;

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
    });

    note.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!moved && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) moved = true;
      if (!moved) return;
      const maxLeft = canvas.clientWidth - note.offsetWidth;
      const maxTop = canvas.clientHeight - note.offsetHeight;
      note.style.left = Math.max(0, Math.min(maxLeft, origLeft + dx)) + 'px';
      note.style.top = Math.max(0, Math.min(maxTop, origTop + dy)) + 'px';
    });

    note.addEventListener('pointerup', function () {
      if (!dragging) return;
      dragging = false;
      note.classList.remove('dragging');
      if (!moved) return;
      fetch('/todos/' + note.dataset.todoId + '/position', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'x=' + note.offsetLeft + '&y=' + note.offsetTop
      });
    });
  });

  canvas.querySelectorAll('.postit-toggle-form').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      const note = form.closest('.postit');
      fetch(form.action, { method: 'POST' }).then(function () {
        note.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
        note.style.opacity = '0';
        note.style.transform += ' scale(0.85)';
        setTimeout(function () { note.remove(); }, 200);
      });
    });
  });
});

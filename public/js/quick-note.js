document.addEventListener('DOMContentLoaded', function () {
  const overlay = document.getElementById('quickNoteModal');
  if (!overlay) return; // not on this page

  const form = document.getElementById('quickNoteForm');
  const input = document.getElementById('quickNoteInput');
  const dateField = document.getElementById('quickNoteDate');
  const nameLabel = overlay.querySelector('.quick-todo-project-name');
  const cancelBtn = document.getElementById('quickNoteCancel');

  function openModal(projectId, projectName) {
    form.action = '/projects/' + projectId + '/notes';
    nameLabel.textContent = projectName;
    input.value = '';
    // Stamp with the date at the moment the modal is opened, rather than
    // when the dashboard page was originally loaded.
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    dateField.value = now.toISOString().slice(0, 10);
    overlay.style.display = 'flex';
    setTimeout(function () { input.focus(); }, 30);
  }

  function closeModal() {
    overlay.style.display = 'none';
  }

  document.querySelectorAll('.quick-note-btn').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      openModal(btn.dataset.projectId, btn.dataset.projectName);
    });
  });

  cancelBtn.addEventListener('click', closeModal);

  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) closeModal();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && overlay.style.display !== 'none') closeModal();
  });
});

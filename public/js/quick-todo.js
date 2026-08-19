document.addEventListener('DOMContentLoaded', function () {
  const overlay = document.getElementById('quickTodoModal');
  if (!overlay) return; // not on this page

  const form = document.getElementById('quickTodoForm');
  const input = document.getElementById('quickTodoInput');
  const nameLabel = document.querySelector('.quick-todo-project-name');
  const cancelBtn = document.getElementById('quickTodoCancel');

  function openModal(projectId, projectName) {
    form.action = '/projects/' + projectId + '/todos';
    nameLabel.textContent = projectName;
    input.value = '';
    overlay.style.display = 'flex';
    // Focus after the browser has painted the modal, otherwise mobile
    // keyboards sometimes fail to open on the same tap that revealed it.
    setTimeout(function () { input.focus(); }, 30);
  }

  function closeModal() {
    overlay.style.display = 'none';
  }

  document.querySelectorAll('.quick-todo-btn').forEach(function (btn) {
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

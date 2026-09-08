// Intercepts any todo "mark done" toggle (checkbox or button, inside a form
// tagged .todo-toggle-form with data-done="0") and offers a quick, skippable
// prompt to record how it was solved before actually submitting. Toggling
// back to not-done (data-done="1") is left alone -- no prompt on undo.
document.addEventListener('DOMContentLoaded', function () {
  const modal = document.getElementById('todoCommentModal');
  if (!modal) return;

  const form = document.getElementById('todoCommentForm');
  const input = document.getElementById('todoCommentInput');
  const skipBtn = document.getElementById('todoCommentSkip');
  let pendingForm = null;

  function openPrompt(toggleForm) {
    pendingForm = toggleForm;
    input.value = '';
    modal.style.display = 'flex';
    setTimeout(function () { input.focus(); }, 30);
  }

  function closePrompt() {
    modal.style.display = 'none';
    pendingForm = null;
  }

  function submitPending(comment) {
    if (!pendingForm) return;
    let commentField = pendingForm.querySelector('input[name="comment"]');
    if (!commentField) {
      commentField = document.createElement('input');
      commentField.type = 'hidden';
      commentField.name = 'comment';
      pendingForm.appendChild(commentField);
    }
    commentField.value = comment;
    pendingForm.dataset.commentHandled = 'true';
    if (pendingForm.requestSubmit) pendingForm.requestSubmit();
    else pendingForm.submit();
  }

  skipBtn.addEventListener('click', function () {
    submitPending('');
    closePrompt();
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    submitPending(input.value.trim());
    closePrompt();
  });

  modal.addEventListener('click', function (e) {
    if (e.target === modal) { submitPending(''); closePrompt(); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && modal.style.display !== 'none') { submitPending(''); closePrompt(); }
  });

  document.querySelectorAll('.todo-toggle-form').forEach(function (toggleForm) {
    toggleForm.addEventListener('submit', function (e) {
      if (toggleForm.dataset.commentHandled === 'true') return; // already prompted, let it through
      if (toggleForm.dataset.done !== '0') return; // only prompt when marking done, not undoing
      e.preventDefault();
      openPrompt(toggleForm);
    });
  });
});

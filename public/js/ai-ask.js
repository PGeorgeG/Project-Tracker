document.addEventListener('DOMContentLoaded', function () {
  const form = document.getElementById('aiAskForm');
  if (!form) return;

  const input = document.getElementById('aiAskInput');
  const btn = document.getElementById('aiAskBtn');
  const answerEl = document.getElementById('aiAskAnswer');
  const errorEl = document.getElementById('aiAskError');
  const csrfMeta = document.querySelector('meta[name="csrf-token"]');
  const csrfToken = csrfMeta ? csrfMeta.content : '';

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    const question = input.value.trim();
    if (!question) return;

    errorEl.style.display = 'none';
    answerEl.style.display = 'none';
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Thinking…';

    fetch('/report/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'question=' + encodeURIComponent(question) + '&_csrf=' + encodeURIComponent(csrfToken)
    })
      .then(function (res) {
        return res.json().then(function (data) { return { ok: res.ok, data: data }; });
      })
      .then(function (result) {
        if (!result.ok) throw new Error(result.data.error || 'Something went wrong.');
        answerEl.innerHTML = result.data.answerHtml;
        answerEl.style.display = 'block';
      })
      .catch(function (err) {
        errorEl.textContent = err.message;
        errorEl.style.display = 'block';
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = originalText;
      });
  });
});

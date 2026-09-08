document.addEventListener('DOMContentLoaded', function () {
  const form = document.getElementById('aiAskForm');
  if (!form) return;

  const input = document.getElementById('aiAskInput');
  const btn = document.getElementById('aiAskBtn');
  const errorEl = document.getElementById('aiAskError');
  const csrfMeta = document.querySelector('meta[name="csrf-token"]');
  const csrfToken = csrfMeta ? csrfMeta.content : '';

  const modal = document.getElementById('aiReportModal');
  const questionEl = document.getElementById('aiReportQuestion');
  const answerEl = document.getElementById('aiReportAnswer');
  const closeBtn = document.getElementById('aiReportClose');
  const copyBtn = document.getElementById('aiReportCopyBtn');
  let lastAnswerText = '';

  function openModal(question, answerHtml, answerText) {
    questionEl.textContent = question;
    answerEl.innerHTML = answerHtml;
    lastAnswerText = answerText;
    modal.style.display = 'flex';
  }

  function closeModal() {
    modal.style.display = 'none';
  }

  closeBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', function (e) {
    if (e.target === modal) closeModal();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && modal.style.display !== 'none') closeModal();
  });

  copyBtn.addEventListener('click', function () {
    // iOS Safari's execCommand('copy') only works reliably with an explicit
    // selection range, not just .select() -- and even then it can fail, so
    // report honestly instead of always claiming success.
    function fallbackCopy(text) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      return ok;
    }

    function showStatus(text) {
      const original = copyBtn.textContent;
      copyBtn.textContent = text;
      setTimeout(function () { copyBtn.textContent = original; }, 1500);
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(lastAnswerText)
        .then(function () { showStatus('Copied!'); })
        .catch(function () { showStatus(fallbackCopy(lastAnswerText) ? 'Copied!' : 'Copy failed — select the text manually'); });
    } else {
      showStatus(fallbackCopy(lastAnswerText) ? 'Copied!' : 'Copy failed — select the text manually');
    }
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    const question = input.value.trim();
    if (!question) return;

    errorEl.style.display = 'none';
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
        openModal(question, result.data.answerHtml, result.data.answer);
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

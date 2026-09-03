// Auto-saves in-progress note/todo text to localStorage as you type, and
// restores it if the page reloads before you hit Save -- mobile browsers
// will silently reload a backgrounded tab (e.g. after switching apps to
// check a file mid-call) to free memory, which otherwise wipes anything
// you'd typed but not yet submitted.
(function () {
  function safeGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function safeSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* storage unavailable */ }
  }
  function safeRemove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* storage unavailable */ }
  }

  // Wires one element for draft saving. Reads el.dataset.draftKey fresh on
  // every keystroke/submit rather than once, so a key assigned dynamically
  // later (e.g. when a modal opens for a particular project) still works.
  function wire(el) {
    el.addEventListener('input', function () {
      const key = el.dataset.draftKey;
      if (key) safeSet('pt-draft:' + key, el.value);
    });
    const form = el.closest('form');
    if (form) {
      form.addEventListener('submit', function () {
        const key = el.dataset.draftKey;
        if (key) safeRemove('pt-draft:' + key);
      });
    }
  }

  function restoreIfEmpty(el) {
    const key = el.dataset.draftKey;
    if (!key || el.value) return;
    const saved = safeGet('pt-draft:' + key);
    if (saved !== null) el.value = saved;
  }

  window.PTDraft = { get: safeGet, set: safeSet, remove: safeRemove, wire: wire };

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-draft-key]').forEach(function (el) {
      restoreIfEmpty(el);
      wire(el);
    });
  });
})();

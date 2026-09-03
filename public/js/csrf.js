// Stamps every POST form on the page with the session's CSRF token, read
// from the <meta name="csrf-token"> tag each view renders. Keeps individual
// forms from having to carry the hidden field themselves.
document.addEventListener('DOMContentLoaded', function () {
  const meta = document.querySelector('meta[name="csrf-token"]');
  const token = meta ? meta.content : '';
  if (!token) return;

  document.querySelectorAll('form').forEach(function (form) {
    if (form.method.toLowerCase() !== 'post') return;
    if (form.querySelector('input[name="_csrf"]')) return;
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = '_csrf';
    input.value = token;
    form.appendChild(input);
  });
});

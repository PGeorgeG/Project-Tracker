document.addEventListener('DOMContentLoaded', function () {
  const btn = document.getElementById('moreMenuBtn');
  const menu = document.getElementById('moreMenu');
  if (!btn || !menu) return; // not on this page

  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
  });

  document.addEventListener('click', function (e) {
    if (menu.style.display === 'block' && !menu.contains(e.target) && e.target !== btn) {
      menu.style.display = 'none';
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') menu.style.display = 'none';
  });
});

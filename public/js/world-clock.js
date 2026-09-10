document.addEventListener('DOMContentLoaded', function () {
  const root = document.getElementById('clockCityList');
  if (!root) return; // not on this page

  const csrfMeta = document.querySelector('meta[name="csrf-token"]');
  const csrfToken = csrfMeta ? csrfMeta.content : '';

  // ---------- Date helpers (ported as-is from the standalone tool) ----------
  // Builds the exact instant in time represented by a date + minutes-of-day,
  // interpreted in the browser's own local time zone -- this becomes the
  // shared "moment" every city's clock is computed from, so scrubbing the
  // slider moves every city together.
  function instantFromLocal(dateISO, minutesOfDay) {
    const [y, m, d] = dateISO.split('-').map(Number);
    const hh = Math.floor(minutesOfDay / 60);
    const mm = minutesOfDay % 60;
    return new Date(y, m - 1, d, hh, mm, 0);
  }

  // Everything about how a given instant looks in a given IANA time zone --
  // time, the zone's own calendar date (to detect a day-offset vs. the
  // anchor), weekday, hour-of-day (for the day/night icon), and its current
  // UTC offset (which naturally reflects daylight saving for that date --
  // no manual DST rules needed).
  function cityTimeInfo(instant, timezone) {
    const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit', hour12: true });
    const hourFmt = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hourCycle: 'h23', hour: 'numeric' });
    const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
    const weekdayFmt = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' });
    const offsetFmt = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'shortOffset' });
    const offsetPart = offsetFmt.formatToParts(instant).find(function (p) { return p.type === 'timeZoneName'; });
    return {
      timeStr: timeFmt.format(instant),
      hour24: parseInt(hourFmt.format(instant), 10) % 24,
      dateISO: dateFmt.format(instant),
      weekday: weekdayFmt.format(instant),
      offset: offsetPart ? offsetPart.value.replace('GMT', 'UTC') : ''
    };
  }

  function uid() {
    return Math.random().toString(36).slice(2, 10);
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---------- State ----------
  const initialDataEl = document.getElementById('clockInitialCities');
  let cities = [];
  try { cities = JSON.parse(initialDataEl.textContent); } catch (e) { cities = []; }

  const now = new Date();
  const todayISO = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  let selectedDate = todayISO;
  let sliderMinutes = now.getHours() * 60 + now.getMinutes();
  let search = '';

  // ---------- DOM refs ----------
  const dateInput = document.getElementById('clockDate');
  const slider = document.getElementById('clockSlider');
  const anchorLabel = document.getElementById('clockAnchorLabel');
  const nowBtn = document.getElementById('clockNowBtn');
  const emptyState = document.getElementById('clockEmptyState');
  const showAddBtn = document.getElementById('clockShowAddBtn');
  const addRow = document.getElementById('clockAddRow');
  const addBox = document.getElementById('clockAddBox');
  const searchInput = document.getElementById('clockSearchInput');
  const cancelAddBtn = document.getElementById('clockCancelAddBtn');
  const searchResults = document.getElementById('clockSearchResults');

  dateInput.value = selectedDate;
  slider.value = sliderMinutes;

  function saveCities() {
    fetch('/clock/cities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'cities=' + encodeURIComponent(JSON.stringify(cities)) + '&_csrf=' + encodeURIComponent(csrfToken)
    });
  }

  function renderCityList() {
    const instant = instantFromLocal(selectedDate, sliderMinutes);
    emptyState.style.display = cities.length === 0 ? 'block' : 'none';
    root.innerHTML = cities.map(function (c) {
      const info = cityTimeInfo(instant, c.timezone);
      const dayDiff = info.dateISO === selectedDate ? 0 : (info.dateISO > selectedDate ? 1 : -1);
      const isDay = info.hour24 >= 6 && info.hour24 < 18;
      const dayNote = dayDiff !== 0
        ? ' <span style="color:var(--red);">&middot; ' + info.weekday + ' (' + (dayDiff > 0 ? '+1 day' : '-1 day') + ')</span>'
        : '';
      return '' +
        '<div class="link-row">' +
        '  <span style="font-size:16px; flex-shrink:0;">' + (isDay ? '☀️' : '🌙') + '</span>' +
        '  <span class="grow" style="min-width:0;">' +
        '    <strong>' + escapeHtml(c.city) + '</strong><br>' +
        '    <span class="muted" style="font-size:11px;">' + escapeHtml(c.country) + ' &middot; ' + escapeHtml(info.offset) + dayNote + '</span>' +
        '  </span>' +
        '  <span style="font-weight:600; font-size:18px; white-space:nowrap;">' + info.timeStr + '</span>' +
        '  <button type="button" class="today-remove-btn remove-city-btn" data-id="' + c.id + '" title="Remove">&times;</button>' +
        '</div>';
    }).join('');
  }

  function renderAnchorLabel() {
    const instant = instantFromLocal(selectedDate, sliderMinutes);
    anchorLabel.textContent = instant.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const isNow = selectedDate === todayISO && Math.abs(sliderMinutes - (new Date().getHours() * 60 + new Date().getMinutes())) < 1;
    nowBtn.style.display = isNow ? 'none' : 'inline-block';
  }

  function renderSearchResults() {
    const term = search.trim().toLowerCase();
    if (!term) { searchResults.innerHTML = ''; return; }
    const matches = CITY_DATABASE.filter(function (c) {
      const alreadyAdded = cities.some(function (added) { return added.timezone === c.timezone && added.city === c.city; });
      return !alreadyAdded && (c.city + ' ' + c.country).toLowerCase().indexOf(term) !== -1;
    }).slice(0, 8);

    if (matches.length === 0) {
      searchResults.innerHTML = '<p class="muted" style="font-size:12px; font-style:italic; margin:4px 0 0;">No matches.</p>';
      return;
    }
    searchResults.innerHTML = matches.map(function (c, i) {
      return '<button type="button" class="btn btn-small add-city-btn" data-index="' + i + '" style="display:flex; justify-content:space-between; width:100%; margin-top:4px; text-align:left;">' +
        '<span>' + escapeHtml(c.city) + ', ' + escapeHtml(c.country) + '</span><span class="muted">+</span></button>';
    }).join('');
    searchResults.dataset.matches = JSON.stringify(matches);
  }

  function renderAll() {
    renderCityList();
    renderAnchorLabel();
    renderSearchResults();
  }

  // ---------- Events ----------
  dateInput.addEventListener('change', function () {
    selectedDate = dateInput.value || todayISO;
    renderAll();
  });

  slider.addEventListener('input', function () {
    sliderMinutes = Number(slider.value);
    renderAll();
  });

  nowBtn.addEventListener('click', function () {
    const n = new Date();
    selectedDate = todayISO;
    sliderMinutes = n.getHours() * 60 + n.getMinutes();
    dateInput.value = selectedDate;
    slider.value = sliderMinutes;
    renderAll();
  });

  showAddBtn.addEventListener('click', function () {
    addRow.style.display = 'none';
    addBox.style.display = 'block';
    searchInput.value = '';
    search = '';
    renderSearchResults();
    setTimeout(function () { searchInput.focus(); }, 30);
  });

  function closeAddBox() {
    addBox.style.display = 'none';
    addRow.style.display = 'block';
    searchInput.value = '';
    search = '';
    searchResults.innerHTML = '';
  }
  cancelAddBtn.addEventListener('click', closeAddBox);

  searchInput.addEventListener('input', function () {
    search = searchInput.value;
    renderSearchResults();
  });

  searchResults.addEventListener('click', function (e) {
    const btn = e.target.closest('.add-city-btn');
    if (!btn) return;
    const matches = JSON.parse(searchResults.dataset.matches || '[]');
    const c = matches[Number(btn.dataset.index)];
    if (!c) return;
    cities.push({ id: uid(), city: c.city, country: c.country, timezone: c.timezone });
    saveCities();
    closeAddBox();
    renderAll();
  });

  root.addEventListener('click', function (e) {
    const btn = e.target.closest('.remove-city-btn');
    if (!btn) return;
    cities = cities.filter(function (c) { return c.id !== btn.dataset.id; });
    saveCities();
    renderAll();
  });

  renderAll();
});

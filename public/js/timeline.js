function pctBetween(start, end, date) {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  const d = new Date(date).getTime();
  if (e === s) return 0;
  let pct = ((d - s) / (e - s)) * 100;
  return Math.max(0, Math.min(100, pct));
}

function clusterNotes(notes, threshold) {
  const sorted = [...notes].sort((a, b) => a.pct - b.pct);
  const clusters = [];
  sorted.forEach(n => {
    const last = clusters[clusters.length - 1];
    if (last && (n.pct - last.pct) < threshold) {
      last.items.push(n);
      last.pct = (last.pct * (last.items.length - 1) + n.pct) / last.items.length;
    } else {
      clusters.push({ pct: n.pct, items: [n] });
    }
  });
  return clusters;
}

function toneClass(tone) {
  if (tone === 'red') return 'tone-red';
  if (tone === 'amber') return 'tone-amber';
  return 'tone-green';
}

function toneLabel(tone) {
  if (tone === 'red') return 'Chokepoint';
  if (tone === 'amber') return 'Warning';
  return 'All good';
}

function fmtDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'to', 'for', 'and', 'or', 'in', 'on', 'with',
  'by', 'at', 'as', 'from', 'into', 'that', 'this', 'is', 'are', 'be',
  'being', 'been', 'it', 'its', 'their', 'our', 'your'
]);

function abbreviate(label) {
  const words = label.split(/\s+/).filter(Boolean);
  const content = words.filter(w => !STOPWORDS.has(w.toLowerCase()));
  const chosen = (content.length ? content : words).slice(0, 2);
  return chosen.map(w => (w.length > 7 ? w.slice(0, 7) : w)).join(' ');
}

function renderTimeline(container) {
  const scriptEl = container.querySelector('script.timeline-json');
  if (!scriptEl) return;
  const data = JSON.parse(scriptEl.textContent);
  const interactive = container.dataset.interactive === 'true';
  const { start, end, stages, notes, progressPct } = data;

  const wrap = document.createElement('div');
  wrap.className = 'track-wrap';
  if (interactive) wrap.id = 'trackWrap';

  const line = document.createElement('div');
  line.className = 'track-line';
  wrap.appendChild(line);

  const fill = document.createElement('div');
  fill.className = 'track-fill';
  fill.style.width = progressPct + '%';
  wrap.appendChild(fill);

  stages.forEach(s => {
    const pct = pctBetween(start, end, s.target_date);
    const dot = document.createElement('div');
    dot.className = 'stage';
    dot.style.left = pct + '%';
    dot.dataset.status = s.status;
    dot.title = s.label + ' — ' + fmtDate(s.target_date);
    wrap.appendChild(dot);

    if (interactive) {
      const label = document.createElement('div');
      label.className = 'stage-label';
      label.style.left = pct + '%';
      label.innerHTML = s.label + '<b>' + fmtDate(s.target_date) + '</b>';
      wrap.appendChild(label);
    } else {
      const label = document.createElement('div');
      label.className = 'stage-label stage-label-mini';
      label.style.left = pct + '%';
      label.textContent = abbreviate(s.label);
      label.title = s.label + ' — ' + fmtDate(s.target_date);
      wrap.appendChild(label);
    }
  });

  const postedNotes = notes.filter(n => n.posted_on_timeline).map(n => ({
    ...n, pct: pctBetween(start, end, n.meeting_date)
  }));
  const clusters = clusterNotes(postedNotes, 3);

  clusters.forEach(cluster => {
    const cEl = document.createElement('div');
    cEl.className = 'note-cluster';
    cEl.style.left = cluster.pct + '%';
    cEl.tabIndex = 0;

    if (cluster.items.length > 1) {
      const count = document.createElement('span');
      count.className = 'cluster-count';
      count.textContent = cluster.items.length;
      cEl.appendChild(count);
    }

    cluster.items.forEach(n => {
      const item = document.createElement('div');
      item.className = 'note-item';
      const diamond = document.createElement('span');
      diamond.className = 'note-diamond ' + toneClass(n.tone);
      item.appendChild(diamond);

      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      bubble.innerHTML = '<p class="b-date">' + fmtDate(n.meeting_date) + ' meeting</p>' +
        '<p class="b-text"></p>' +
        '<p class="b-tone ' + toneClass(n.tone) + '">' + toneLabel(n.tone) + '</p>';
      bubble.querySelector('.b-text').textContent = n.text;
      item.appendChild(bubble);

      cEl.appendChild(item);
    });

    wrap.appendChild(cEl);
  });

  container.innerHTML = '';
  container.appendChild(wrap);

  if (interactive) {
    wrap.addEventListener('click', function (e) {
      if (e.target.closest('.note-cluster')) return;
      toggleLogSection();
    });
  }
}

function toggleLogSection(forceOpen) {
  const log = document.getElementById('logSection');
  if (!log) return;
  const opening = typeof forceOpen === 'boolean' ? forceOpen : log.style.display === 'none';
  log.style.display = opening ? 'block' : 'none';
  const btn = document.getElementById('toggleLogBtn');
  if (btn) btn.textContent = opening ? 'Hide meeting log' : 'See all notes';
}

document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('.timeline-mount').forEach(function (el) {
    try {
      renderTimeline(el);
    } catch (e) {
      console.error('Timeline failed to render', e);
    }
  });

  const postToggle = document.getElementById('postToggle');
  if (postToggle) {
    postToggle.addEventListener('change', function (e) {
      document.getElementById('toneRow').style.display = e.target.checked ? 'flex' : 'none';
    });
  }

  const toggleLogBtn = document.getElementById('toggleLogBtn');
  if (toggleLogBtn) {
    toggleLogBtn.addEventListener('click', function () { toggleLogSection(); });
  }
});

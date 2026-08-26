const express = require('express');
const session = require('express-session');
const path = require('path');
const db = require('./db');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1); // Railway sits behind a proxy that terminates TLS
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'change-me-in-railway-env-vars',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000 // stay logged in for 30 days
  }
}));

// Password gate: everything except /login and static assets requires a session.
app.use(function (req, res, next) {
  if (req.path === '/login' || req.path.startsWith('/css') || req.path.startsWith('/js')) {
    return next();
  }
  if (req.session && req.session.authenticated) {
    return next();
  }
  res.redirect('/login');
});

app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const appPassword = process.env.APP_PASSWORD;
  if (!appPassword) {
    return res.render('login', { error: 'APP_PASSWORD is not set on the server. Add it in Railway environment variables.' });
  }
  if (req.body.password === appPassword) {
    req.session.authenticated = true;
    return res.redirect('/');
  }
  res.render('login', { error: 'Incorrect password.' });
});

app.post('/logout', (req, res) => {
  req.session.destroy(function () {
    res.redirect('/login');
  });
});

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Renders freeform outcome text: lines starting with "- " or "* " become
// bullet points, blank lines separate paragraphs, single newlines become <br>.
function renderOutcome(text) {
  if (!text) return '';
  const lines = String(text).split(/\r?\n/);
  let html = '';
  let inList = false;
  let paragraphLines = [];

  function flushParagraph() {
    if (paragraphLines.length) {
      html += '<p>' + paragraphLines.join('<br>') + '</p>';
      paragraphLines = [];
    }
  }
  function closeList() {
    if (inList) { html += '</ul>'; inList = false; }
  }

  lines.forEach(line => {
    const trimmed = line.trim();
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      flushParagraph();
      if (!inList) { html += '<ul>'; inList = true; }
      html += '<li>' + escapeHtml(trimmed.slice(2)) + '</li>';
    } else if (trimmed === '') {
      closeList();
      flushParagraph();
    } else {
      closeList();
      paragraphLines.push(escapeHtml(line));
    }
  });
  closeList();
  flushParagraph();
  return html;
}

app.locals.renderOutcome = renderOutcome;

// Classifies a todo's due date relative to today: 'overdue', 'soon' (within
// 2 days), or null (no urgency styling needed).
function todoUrgency(due_date) {
  if (!due_date) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(due_date + 'T00:00:00');
  const diffDays = Math.floor((due - today) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return 'overdue';
  if (diffDays <= 2) return 'soon';
  return null;
}
app.locals.todoUrgency = todoUrgency;

// Safely embeds JSON inside a <script type="application/json"> block by
// escaping characters that could prematurely close the tag or be
// misinterpreted by the HTML parser. Avoids the class of bugs caused by
// apostrophes/quotes in user text breaking a quoted HTML attribute.
function safeJson(obj) {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}
app.locals.safeJson = safeJson;

const STATUS_TAGS = ['on track', 'at risk', 'stalled'];
const CADENCES = ['weekly', 'biweekly', 'monthly', 'ad hoc'];
const STAGE_STATUSES = ['pending', 'current', 'done', 'blocked'];
const TONES = ['red', 'amber', 'green'];

function getProject(id) {
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
}

// ---------- Dashboard ----------
app.get('/', (req, res) => {
  const showArchived = req.query.archived === '1';
  const projects = db.prepare(
    `SELECT * FROM projects WHERE archived = ? ORDER BY sort_order ASC, created_at ASC`
  ).all(showArchived ? 1 : 0);

  const projectData = projects.map(p => {
    const stages = db.prepare('SELECT * FROM stages WHERE project_id = ? ORDER BY target_date ASC').all(p.id);
    const notes = db.prepare('SELECT * FROM notes WHERE project_id = ? ORDER BY meeting_date ASC').all(p.id);
    const openAlerts = db.prepare('SELECT COUNT(*) c FROM alerts WHERE project_id = ? AND dismissed = 0').get(p.id).c;
    const openTodos = db.prepare('SELECT * FROM todos WHERE project_id = ? AND done = 0 ORDER BY due_date ASC').all(p.id);
    const links = db.prepare('SELECT * FROM links WHERE project_id = ? ORDER BY created_at ASC').all(p.id);
    return { ...p, stages, notes, openAlerts, openTodos, links };
  });

  const todayStr = new Date().toISOString().slice(0, 10);
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrowStr = tomorrowDate.toISOString().slice(0, 10);

  const todayListTodos = db.prepare(`
    SELECT todos.*, projects.name AS project_name, projects.color AS project_color
    FROM todos
    JOIN projects ON projects.id = todos.project_id
    WHERE todos.done = 0 AND todos.today_list_date = ? AND projects.archived = 0
    ORDER BY todos.id ASC
  `).all(todayStr);

  const todayListAlerts = db.prepare(`
    SELECT alerts.*, projects.name AS project_name, projects.color AS project_color
    FROM alerts
    JOIN projects ON projects.id = alerts.project_id
    WHERE alerts.dismissed = 0 AND alerts.today_list_date = ? AND projects.archived = 0
    ORDER BY alerts.id ASC
  `).all(todayStr);

  const globalTodos = db.prepare(`
    SELECT todos.*, projects.name AS project_name, projects.color AS project_color
    FROM todos
    JOIN projects ON projects.id = todos.project_id
    WHERE todos.done = 0 AND todos.due_date IS NOT NULL AND projects.archived = 0
    ORDER BY todos.due_date ASC
  `).all();

  const globalAlerts = db.prepare(`
    SELECT alerts.*, projects.name AS project_name, projects.color AS project_color
    FROM alerts
    JOIN projects ON projects.id = alerts.project_id
    WHERE alerts.dismissed = 0 AND projects.archived = 0
    ORDER BY alerts.trigger_date ASC
  `).all();

  res.render('dashboard', { projects: projectData, showArchived, globalTodos, globalAlerts, todayListTodos, todayListAlerts, todayStr, tomorrowStr });
});

// ---------- Create project ----------
app.get('/projects/new', (req, res) => {
  res.render('new-project', { STATUS_TAGS, CADENCES });
});

app.post('/projects', (req, res) => {
  const { name, outcome, lead_name, start_date, end_date, status_tag, cadence, color } = req.body;
  if (!name || !outcome || !lead_name || !start_date || !end_date) {
    return res.status(400).send('Missing required fields');
  }
  const maxOrder = db.prepare('SELECT MAX(sort_order) m FROM projects').get().m;
  const nextOrder = (maxOrder === null ? -1 : maxOrder) + 1;
  const stmt = db.prepare(`INSERT INTO projects (name, outcome, lead_name, start_date, end_date, status_tag, cadence, color, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const info = stmt.run(name, outcome, lead_name, start_date, end_date, status_tag || '', cadence || '', color || '#378ADD', nextOrder);
  res.redirect('/projects/' + info.lastInsertRowid);
});

// ---------- Project detail ----------
app.get('/projects/:id', (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).send('Project not found');

  const stages = db.prepare('SELECT * FROM stages WHERE project_id = ? ORDER BY target_date ASC').all(project.id);
  const notes = db.prepare('SELECT * FROM notes WHERE project_id = ? ORDER BY meeting_date ASC').all(project.id);
  const todos = db.prepare('SELECT * FROM todos WHERE project_id = ? ORDER BY done ASC, due_date ASC').all(project.id);
  const alerts = db.prepare('SELECT * FROM alerts WHERE project_id = ? AND dismissed = 0 ORDER BY trigger_date ASC').all(project.id);
  const links = db.prepare('SELECT * FROM links WHERE project_id = ? ORDER BY created_at ASC').all(project.id);

  res.render('project', {
    project, stages, notes, todos, alerts, links,
    STATUS_TAGS, CADENCES, STAGE_STATUSES, TONES
  });
});

app.post('/projects/:id/edit', (req, res) => {
  const { name, outcome, lead_name, start_date, end_date, status_tag, cadence, color } = req.body;
  db.prepare(`UPDATE projects SET name=?, outcome=?, lead_name=?, start_date=?, end_date=?, status_tag=?, cadence=?, color=? WHERE id=?`)
    .run(name, outcome, lead_name, start_date, end_date, status_tag || '', cadence || '', color || '#378ADD', req.params.id);
  res.redirect('/projects/' + req.params.id);
});

app.post('/projects/:id/archive', (req, res) => {
  const project = getProject(req.params.id);
  db.prepare('UPDATE projects SET archived = ? WHERE id = ?').run(project.archived ? 0 : 1, req.params.id);
  res.redirect('/');
});

app.post('/projects/:id/move', (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).send('Project not found');
  const direction = req.body.direction;

  const siblings = db.prepare(
    'SELECT * FROM projects WHERE archived = ? ORDER BY sort_order ASC, created_at ASC'
  ).all(project.archived);

  const idx = siblings.findIndex(p => p.id === project.id);
  const neighborIdx = direction === 'up' ? idx - 1 : idx + 1;

  if (neighborIdx >= 0 && neighborIdx < siblings.length) {
    const neighbor = siblings[neighborIdx];
    const swap = db.transaction(() => {
      db.prepare('UPDATE projects SET sort_order = ? WHERE id = ?').run(neighbor.sort_order, project.id);
      db.prepare('UPDATE projects SET sort_order = ? WHERE id = ?').run(project.sort_order, neighbor.id);
    });
    swap();
  }

  res.redirect('/' + (project.archived ? '?archived=1' : ''));
});

// ---------- Stages ----------
app.post('/projects/:id/stages', (req, res) => {
  const { label, target_date, status } = req.body;
  db.prepare('INSERT INTO stages (project_id, label, target_date, status) VALUES (?, ?, ?, ?)')
    .run(req.params.id, label, target_date, status || 'pending');
  res.redirect('/projects/' + req.params.id);
});

app.post('/projects/:id/stages/:stageId/edit', (req, res) => {
  const { label, target_date, status } = req.body;
  db.prepare('UPDATE stages SET label=?, target_date=?, status=? WHERE id=? AND project_id=?')
    .run(label, target_date, status, req.params.stageId, req.params.id);
  res.redirect('/projects/' + req.params.id);
});

app.post('/projects/:id/stages/:stageId/delete', (req, res) => {
  db.prepare('DELETE FROM stages WHERE id=? AND project_id=?').run(req.params.stageId, req.params.id);
  res.redirect('/projects/' + req.params.id);
});

// ---------- Notes ----------
app.post('/projects/:id/notes', (req, res) => {
  const { meeting_date, text, posted_on_timeline, tone } = req.body;
  const posted = posted_on_timeline ? 1 : 0;
  db.prepare('INSERT INTO notes (project_id, meeting_date, text, posted_on_timeline, tone) VALUES (?, ?, ?, ?, ?)')
    .run(req.params.id, meeting_date, text, posted, posted ? (tone || 'green') : null);
  res.redirect('/projects/' + req.params.id);
});

app.post('/projects/:id/notes/:noteId/edit', (req, res) => {
  const { meeting_date, text, posted_on_timeline, tone } = req.body;
  const posted = posted_on_timeline ? 1 : 0;
  db.prepare('UPDATE notes SET meeting_date=?, text=?, posted_on_timeline=?, tone=? WHERE id=? AND project_id=?')
    .run(meeting_date, text, posted, posted ? (tone || 'green') : null, req.params.noteId, req.params.id);
  res.redirect('/projects/' + req.params.id);
});

app.post('/projects/:id/notes/:noteId/delete', (req, res) => {
  db.prepare('DELETE FROM notes WHERE id=? AND project_id=?').run(req.params.noteId, req.params.id);
  res.redirect('/projects/' + req.params.id);
});

// ---------- Todos ----------
app.post('/projects/:id/todos', (req, res) => {
  const { text, due_date } = req.body;
  db.prepare('INSERT INTO todos (project_id, text, due_date) VALUES (?, ?, ?)')
    .run(req.params.id, text, due_date || null);
  res.redirect('/projects/' + req.params.id);
});

app.post('/projects/:id/todos/:todoId/edit', (req, res) => {
  const { text, due_date } = req.body;
  db.prepare('UPDATE todos SET text=?, due_date=? WHERE id=? AND project_id=?')
    .run(text, due_date || null, req.params.todoId, req.params.id);
  res.redirect('/projects/' + req.params.id);
});

app.post('/projects/:id/todos/:todoId/toggle', (req, res) => {
  const todo = db.prepare('SELECT * FROM todos WHERE id=? AND project_id=?').get(req.params.todoId, req.params.id);
  const newDone = todo.done ? 0 : 1;
  const completedAt = newDone ? new Date().toISOString() : null;
  db.prepare('UPDATE todos SET done=?, completed_at=? WHERE id=?').run(newDone, completedAt, req.params.todoId);
  res.redirect((req.body && req.body.redirect_to) || ('/projects/' + req.params.id));
});

app.post('/projects/:id/todos/:todoId/today', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  db.prepare('UPDATE todos SET today_list_date=? WHERE id=? AND project_id=?').run(today, req.params.todoId, req.params.id);
  res.redirect((req.body && req.body.redirect_to) || ('/projects/' + req.params.id));
});

app.post('/projects/:id/todos/:todoId/today/remove', (req, res) => {
  db.prepare('UPDATE todos SET today_list_date=NULL WHERE id=? AND project_id=?').run(req.params.todoId, req.params.id);
  res.redirect((req.body && req.body.redirect_to) || ('/projects/' + req.params.id));
});

app.post('/projects/:id/todos/:todoId/delete', (req, res) => {
  db.prepare('DELETE FROM todos WHERE id=? AND project_id=?').run(req.params.todoId, req.params.id);
  res.redirect('/projects/' + req.params.id);
});

// ---------- Alerts ----------
app.post('/projects/:id/alerts', (req, res) => {
  const { note, trigger_date } = req.body;
  db.prepare('INSERT INTO alerts (project_id, note, trigger_date) VALUES (?, ?, ?)')
    .run(req.params.id, note, trigger_date);
  res.redirect('/projects/' + req.params.id);
});

app.post('/projects/:id/alerts/:alertId/dismiss', (req, res) => {
  db.prepare('UPDATE alerts SET dismissed = 1 WHERE id=? AND project_id=?').run(req.params.alertId, req.params.id);
  res.redirect((req.body && req.body.redirect_to) || ('/projects/' + req.params.id));
});

app.post('/projects/:id/alerts/:alertId/today', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  db.prepare('UPDATE alerts SET today_list_date=? WHERE id=? AND project_id=?').run(today, req.params.alertId, req.params.id);
  res.redirect((req.body && req.body.redirect_to) || ('/projects/' + req.params.id));
});

app.post('/projects/:id/alerts/:alertId/today/remove', (req, res) => {
  db.prepare('UPDATE alerts SET today_list_date=NULL WHERE id=? AND project_id=?').run(req.params.alertId, req.params.id);
  res.redirect((req.body && req.body.redirect_to) || ('/projects/' + req.params.id));
});

// ---------- Links ----------
function guessDescriptionFromUrl(url) {
  try {
    const u = new URL(url);
    const segments = u.pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1];
    if (last) return decodeURIComponent(last);
    return u.hostname;
  } catch (e) {
    return url;
  }
}

app.post('/projects/:id/links', (req, res) => {
  let { description, url } = req.body;
  if (!url) return res.redirect('/projects/' + req.params.id);
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  if (!description || !description.trim()) description = guessDescriptionFromUrl(url);
  db.prepare('INSERT INTO links (project_id, description, url) VALUES (?, ?, ?)')
    .run(req.params.id, description.trim(), url);
  res.redirect('/projects/' + req.params.id);
});

app.post('/projects/:id/links/:linkId/delete', (req, res) => {
  db.prepare('DELETE FROM links WHERE id=? AND project_id=?').run(req.params.linkId, req.params.id);
  res.redirect('/projects/' + req.params.id);
});

// ---------- Report ----------
app.get('/report', (req, res) => {
  const today = new Date();
  const defaultEnd = today.toISOString().slice(0, 10);
  const defaultStartDate = new Date(today);
  defaultStartDate.setDate(defaultStartDate.getDate() - 30);
  const defaultStart = defaultStartDate.toISOString().slice(0, 10);

  const start = req.query.start || defaultStart;
  const end = req.query.end || defaultEnd;

  const futureCutoffDate = new Date(end + 'T00:00:00');
  futureCutoffDate.setDate(futureCutoffDate.getDate() + 30);
  const futureCutoff = futureCutoffDate.toISOString().slice(0, 10);

  const projects = db.prepare(
    'SELECT * FROM projects WHERE archived = 0 ORDER BY sort_order ASC, created_at ASC'
  ).all();

  const reportData = projects.map(p => {
    const notes = db.prepare(
      'SELECT * FROM notes WHERE project_id=? AND meeting_date BETWEEN ? AND ? ORDER BY meeting_date ASC'
    ).all(p.id, start, end);

    const blockedStages = db.prepare(
      "SELECT * FROM stages WHERE project_id=? AND status='blocked' ORDER BY target_date ASC"
    ).all(p.id);

    const openAlerts = db.prepare(
      'SELECT * FROM alerts WHERE project_id=? AND dismissed=0 ORDER BY trigger_date ASC'
    ).all(p.id);

    const completedTodos = db.prepare(
      "SELECT * FROM todos WHERE project_id=? AND done=1 AND completed_at IS NOT NULL AND date(completed_at) BETWEEN ? AND ? ORDER BY completed_at ASC"
    ).all(p.id, start, end);

    const newOpenTodos = db.prepare(
      "SELECT * FROM todos WHERE project_id=? AND done=0 AND date(created_at) BETWEEN ? AND ? ORDER BY created_at ASC"
    ).all(p.id, start, end);

    const carryoverTodos = db.prepare(
      "SELECT * FROM todos WHERE project_id=? AND done=0 AND date(created_at) < ? ORDER BY due_date ASC"
    ).all(p.id, start);

    const upcomingStages = db.prepare(
      "SELECT * FROM stages WHERE project_id=? AND status NOT IN ('done','blocked') AND target_date BETWEEN ? AND ? ORDER BY target_date ASC"
    ).all(p.id, end, futureCutoff);

    const upcomingTodos = db.prepare(
      'SELECT * FROM todos WHERE project_id=? AND done=0 AND due_date BETWEEN ? AND ? ORDER BY due_date ASC'
    ).all(p.id, end, futureCutoff);

    return {
      ...p, notes, blockedStages, openAlerts, completedTodos, newOpenTodos, carryoverTodos, upcomingStages, upcomingTodos,
      chokepointNotes: notes.filter(n => n.tone === 'red'),
      warningNotes: notes.filter(n => n.tone === 'amber'),
      successNotes: notes.filter(n => n.tone === 'green')
    };
  });

  const totals = {
    projects: reportData.length,
    notes: reportData.reduce((sum, p) => sum + p.notes.length, 0),
    chokepoints: reportData.reduce((sum, p) => sum + p.chokepointNotes.length, 0),
    successes: reportData.reduce((sum, p) => sum + p.successNotes.length, 0),
    completedTodos: reportData.reduce((sum, p) => sum + p.completedTodos.length, 0),
    openTodos: reportData.reduce((sum, p) => sum + p.carryoverTodos.length + p.newOpenTodos.length, 0)
  };

  res.render('report', { reportData, start, end, totals });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Project tracker running on port ' + PORT));

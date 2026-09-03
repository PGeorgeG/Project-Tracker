const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
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

// Every authenticated session gets a CSRF token, exposed to views as
// `csrfToken` so forms can carry it in a hidden field (see public/js/csrf.js,
// which injects it automatically) and fetch() calls can include it
// explicitly. Scoped to authenticated sessions so an anonymous visit to
// /login doesn't spin up a session of its own.
app.use(function (req, res, next) {
  if (req.session && req.session.authenticated) {
    if (!req.session.csrfToken) {
      req.session.csrfToken = crypto.randomBytes(24).toString('hex');
    }
    res.locals.csrfToken = req.session.csrfToken;
  }
  next();
});

// Login attempts are shared across everyone using the same password, so a
// per-IP lockout (rather than per-session) is what actually stops guessing:
// 5 wrong passwords from one IP locks it out for 15 minutes. State lives in
// memory only — it resets on a redeploy/restart, which is fine at this scale.
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // a stale attempt streak stops counting after this long
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;
const loginAttempts = new Map(); // ip -> { count, lastAttempt, lockedUntil }

function getLoginState(ip) {
  const state = loginAttempts.get(ip);
  if (!state) return { count: 0, lastAttempt: 0, lockedUntil: 0 };
  const now = Date.now();
  const stale = state.lockedUntil ? state.lockedUntil <= now : (now - state.lastAttempt > LOGIN_WINDOW_MS);
  if (stale) {
    loginAttempts.delete(ip);
    return { count: 0, lastAttempt: 0, lockedUntil: 0 };
  }
  return state;
}

app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const now = Date.now();
  const state = getLoginState(req.ip);

  if (state.lockedUntil > now) {
    const minutesLeft = Math.ceil((state.lockedUntil - now) / 60000);
    return res.render('login', { error: `Too many failed attempts. Try again in ${minutesLeft} minute${minutesLeft === 1 ? '' : 's'}.` });
  }

  const appPassword = process.env.APP_PASSWORD;
  if (!appPassword) {
    return res.render('login', { error: 'APP_PASSWORD is not set on the server. Add it in Railway environment variables.' });
  }

  if (req.body.password === appPassword) {
    loginAttempts.delete(req.ip);
    req.session.authenticated = true;
    return res.redirect('/');
  }

  const count = state.count + 1;
  if (count >= LOGIN_MAX_ATTEMPTS) {
    loginAttempts.set(req.ip, { count: 0, lastAttempt: now, lockedUntil: now + LOGIN_LOCKOUT_MS });
    return res.render('login', { error: `Too many failed attempts. Try again in ${Math.ceil(LOGIN_LOCKOUT_MS / 60000)} minutes.` });
  }
  loginAttempts.set(req.ip, { count, lastAttempt: now, lockedUntil: 0 });
  res.render('login', { error: 'Incorrect password.' });
});

app.post('/logout', (req, res) => {
  req.session.destroy(function () {
    res.redirect('/login');
  });
});

// CSRF check for every other POST: the form (or fetch call) must echo back
// this session's token, so a request forged from another site — which has
// no way to read it — gets rejected even though the browser still sends
// the session cookie automatically.
app.use(function (req, res, next) {
  if (req.method !== 'POST') return next();
  if (req.body && req.body._csrf && req.body._csrf === req.session.csrfToken) {
    return next();
  }
  res.status(403).send('This form session has expired. Go back, reload the page, and try again.');
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

// Shared by the dashboard and the board page, so "Today's List" is always
// the same set of pinned todos/alerts regardless of which page pinned them.
function getTodayList() {
  const todayStr = new Date().toISOString().slice(0, 10);

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

  return { todayStr, todayListTodos, todayListAlerts };
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

  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrowStr = tomorrowDate.toISOString().slice(0, 10);

  const { todayStr, todayListTodos, todayListAlerts } = getTodayList();

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

// Every new project starts with a baseline Aug 1 - Jul 31 fiscal-year
// timeline (the org's standard cycle), anchored to whichever fiscal year
// the project's start date falls in. Fully editable afterward -- the lead
// can rename, reschedule, delete, or add to these like any other stage.
function defaultFiscalYearStages(startDateStr) {
  const start = new Date(startDateStr + 'T00:00:00');
  const fyStartYear = start.getMonth() >= 7 ? start.getFullYear() : start.getFullYear() - 1;
  return [
    { label: 'FY Bgns', target_date: `${fyStartYear}-08-01` },
    { label: 'Mid Year', target_date: `${fyStartYear + 1}-02-01` },
    { label: 'FYE', target_date: `${fyStartYear + 1}-07-31` }
  ];
}

app.post('/projects', (req, res) => {
  const { name, outcome, lead_name, start_date, end_date, status_tag, cadence, color, icon } = req.body;
  if (!name || !outcome || !lead_name || !start_date || !end_date) {
    return res.status(400).send('Missing required fields');
  }
  const maxOrder = db.prepare('SELECT MAX(sort_order) m FROM projects').get().m;
  const nextOrder = (maxOrder === null ? -1 : maxOrder) + 1;
  const stmt = db.prepare(`INSERT INTO projects (name, outcome, lead_name, start_date, end_date, status_tag, cadence, color, icon, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const info = stmt.run(name, outcome, lead_name, start_date, end_date, status_tag || '', cadence || '', color || '#378ADD', (icon || '').trim() || null, nextOrder);

  const insertStage = db.prepare('INSERT INTO stages (project_id, label, target_date, status, sort_order) VALUES (?, ?, ?, ?, ?)');
  defaultFiscalYearStages(start_date).forEach((s, i) => {
    insertStage.run(info.lastInsertRowid, s.label, s.target_date, 'pending', i);
  });

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
  const { name, outcome, lead_name, start_date, end_date, status_tag, cadence, color, icon } = req.body;
  db.prepare(`UPDATE projects SET name=?, outcome=?, lead_name=?, start_date=?, end_date=?, status_tag=?, cadence=?, color=?, icon=? WHERE id=?`)
    .run(name, outcome, lead_name, start_date, end_date, status_tag || '', cadence || '', color || '#378ADD', (icon || '').trim() || null, req.params.id);
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
  res.redirect((req.body && req.body.redirect_to) || ('/projects/' + req.params.id));
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
  res.redirect((req.body && req.body.redirect_to) || ('/projects/' + req.params.id));
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

app.post('/projects/:id/links/:linkId/edit', (req, res) => {
  let { description, url } = req.body;
  if (!url) return res.redirect('/projects/' + req.params.id);
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  if (!description || !description.trim()) description = guessDescriptionFromUrl(url);
  db.prepare('UPDATE links SET description=?, url=? WHERE id=? AND project_id=?')
    .run(description.trim(), url, req.params.linkId, req.params.id);
  res.redirect('/projects/' + req.params.id);
});

app.post('/projects/:id/links/:linkId/delete', (req, res) => {
  db.prepare('DELETE FROM links WHERE id=? AND project_id=?').run(req.params.linkId, req.params.id);
  res.redirect('/projects/' + req.params.id);
});

// ---------- Search ----------
// Escapes LIKE wildcards in user input so a literal % or _ in the query
// isn't treated as a wildcard, then wraps it for a substring match.
function likeParam(term) {
  return '%' + term.replace(/[\\%_]/g, '\\$&') + '%';
}

// Builds "field LIKE ? ESCAPE '\' AND field LIKE ? ESCAPE '\' AND ..." (one
// clause per term) so a multi-word query requires every term to appear,
// in any order — a simple implicit-AND search.
function allTermsClause(field, terms) {
  return terms.map(() => `${field} LIKE ? ESCAPE '\\'`).join(' AND ');
}

app.get('/search', (req, res) => {
  const q = (req.query.q || '').trim();
  const terms = q.split(/\s+/).filter(Boolean);
  const params = terms.map(likeParam);
  let todos = [], alerts = [], notes = [], links = [];

  if (terms.length > 0) {
    todos = db.prepare(`
      SELECT todos.*, projects.name AS project_name, projects.color AS project_color, projects.archived AS project_archived
      FROM todos JOIN projects ON projects.id = todos.project_id
      WHERE ${allTermsClause('todos.text', terms)}
      ORDER BY todos.done ASC, todos.due_date ASC
    `).all(params);

    alerts = db.prepare(`
      SELECT alerts.*, projects.name AS project_name, projects.color AS project_color, projects.archived AS project_archived
      FROM alerts JOIN projects ON projects.id = alerts.project_id
      WHERE ${allTermsClause('alerts.note', terms)}
      ORDER BY alerts.dismissed ASC, alerts.trigger_date ASC
    `).all(params);

    notes = db.prepare(`
      SELECT notes.*, projects.name AS project_name, projects.color AS project_color, projects.archived AS project_archived
      FROM notes JOIN projects ON projects.id = notes.project_id
      WHERE ${allTermsClause('notes.text', terms)}
      ORDER BY notes.meeting_date DESC
    `).all(params);

    links = db.prepare(`
      SELECT links.*, projects.name AS project_name, projects.color AS project_color, projects.archived AS project_archived
      FROM links JOIN projects ON projects.id = links.project_id
      WHERE ${allTermsClause('links.description', terms)}
      ORDER BY links.created_at DESC
    `).all(params);
  }

  res.render('search', { q, todos, alerts, notes, links });
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

// ---------- Completed todos ----------
app.get('/completed-todos', (req, res) => {
  const completedTodos = db.prepare(`
    SELECT todos.*, projects.name AS project_name, projects.color AS project_color, projects.archived AS project_archived
    FROM todos
    JOIN projects ON projects.id = todos.project_id
    WHERE todos.done = 1
    ORDER BY todos.completed_at DESC, todos.id DESC
  `).all();

  res.render('completed-todos', { completedTodos });
});

// ---------- Backup & export ----------
// Uses SQLite's online backup API for a consistent, corruption-safe copy
// even if the app is mid-write, rather than reading the live file directly.
app.get('/backup', async (req, res) => {
  const todayStr = new Date().toISOString().slice(0, 10);
  const filename = `project-tracker-backup-${todayStr}.db`;
  const tempPath = path.join(os.tmpdir(), `pt-backup-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  try {
    await db.backup(tempPath);
    res.download(tempPath, filename, (err) => {
      fs.unlink(tempPath, () => {});
      if (err && !res.headersSent) res.status(500).send('Backup download failed');
    });
  } catch (err) {
    fs.unlink(tempPath, () => {});
    res.status(500).send('Backup failed: ' + err.message);
  }
});

const CSV_TABLES = ['projects', 'stages', 'notes', 'todos', 'alerts', 'links'];

function toCsv(rows) {
  if (rows.length === 0) return '';
  const columns = Object.keys(rows[0]);
  const escapeField = (value) => {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (/[",\n\r]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
    return str;
  };
  const lines = [columns.join(',')];
  rows.forEach(row => {
    lines.push(columns.map(c => escapeField(row[c])).join(','));
  });
  return lines.join('\r\n');
}

app.get('/export', (req, res) => {
  res.render('export', { tables: CSV_TABLES });
});

app.get('/export/csv/:table', (req, res) => {
  const table = req.params.table;
  if (!CSV_TABLES.includes(table)) return res.status(404).send('Unknown table');
  const rows = db.prepare(`SELECT * FROM ${table} ORDER BY id ASC`).all();
  const csv = toCsv(rows);
  const todayStr = new Date().toISOString().slice(0, 10);
  res.set('Content-Type', 'text/csv');
  res.set('Content-Disposition', `attachment; filename="${table}-${todayStr}.csv"`);
  res.send(csv);
});

// ---------- Board ----------
// New todos with no saved position yet wait in the holding box above the
// canvas until dragged out, rather than being auto-placed on the board.
app.get('/board', (req, res) => {
  const allTodos = db.prepare(`
    SELECT todos.*, projects.name AS project_name, projects.color AS project_color
    FROM todos
    JOIN projects ON projects.id = todos.project_id
    WHERE todos.done = 0 AND projects.archived = 0
    ORDER BY todos.created_at ASC
  `).all();

  // New todos start with no board position and wait in the holding box
  // (rendered above the canvas) until dragged onto the board, rather than
  // being auto-placed where they'd overlap existing notes.
  const todos = allTodos.filter(t => t.board_x !== null && t.board_y !== null);
  const holdingTodos = allTodos.filter(t => t.board_x === null || t.board_y === null);

  const { todayStr, todayListTodos, todayListAlerts } = getTodayList();

  res.render('board', { todos, holdingTodos, todayStr, todayListTodos, todayListAlerts });
});

app.post('/todos/:id/position', (req, res) => {
  const x = parseInt(req.body.x, 10);
  const y = parseInt(req.body.y, 10);
  if (Number.isNaN(x) || Number.isNaN(y)) return res.sendStatus(400);
  db.prepare('UPDATE todos SET board_x = ?, board_y = ? WHERE id = ?').run(x, y, req.params.id);
  res.sendStatus(204);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Project tracker running on port ' + PORT));

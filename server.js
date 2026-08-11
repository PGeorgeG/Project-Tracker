const express = require('express');
const path = require('path');
const db = require('./db');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

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
    `SELECT * FROM projects WHERE archived = ? ORDER BY created_at DESC`
  ).all(showArchived ? 1 : 0);

  const projectData = projects.map(p => {
    const stages = db.prepare('SELECT * FROM stages WHERE project_id = ? ORDER BY target_date ASC').all(p.id);
    const openAlerts = db.prepare('SELECT COUNT(*) c FROM alerts WHERE project_id = ? AND dismissed = 0').get(p.id).c;
    const openTodos = db.prepare('SELECT COUNT(*) c FROM todos WHERE project_id = ? AND done = 0').get(p.id).c;
    return { ...p, stages, openAlerts, openTodos };
  });

  res.render('dashboard', { projects: projectData, showArchived });
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
  const stmt = db.prepare(`INSERT INTO projects (name, outcome, lead_name, start_date, end_date, status_tag, cadence, color)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const info = stmt.run(name, outcome, lead_name, start_date, end_date, status_tag || '', cadence || '', color || '#378ADD');
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

  res.render('project', {
    project, stages, notes, todos, alerts,
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

app.post('/projects/:id/todos/:todoId/toggle', (req, res) => {
  const todo = db.prepare('SELECT * FROM todos WHERE id=? AND project_id=?').get(req.params.todoId, req.params.id);
  db.prepare('UPDATE todos SET done=? WHERE id=?').run(todo.done ? 0 : 1, req.params.todoId);
  res.redirect('/projects/' + req.params.id);
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
  res.redirect('/projects/' + req.params.id);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Project tracker running on port ' + PORT));

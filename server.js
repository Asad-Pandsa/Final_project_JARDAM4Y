const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = '123123'; // process.env.ADMIN_KEY || '123123';

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Create table if not exists
db.init();

// Authentication middleware
async function authenticateUser(req, res, next) {
  const token = req.header('Authorization')?.replace('Bearer ', '') || req.header('x-auth-token');

  if (!token) {
    return res.status(401).json({ success: false, error: 'Требуется авторизация' });
  }

  try {
    const session = await db.getSessionByToken(token);
    if (!session) {
      return res.status(401).json({ success: false, error: 'Недействительный токен' });
    }

    const user = await db.getUserById(session.user_id);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Пользователь не найден' });
    }

    req.user = user;
    req.userId = user.id;
    next();
  } catch (err) {
    console.error('Auth error:', err);
    res.status(500).json({ success: false, error: 'Ошибка авторизации' });
  }
}

// Create application (requires authentication)
app.post('/api/applications', authenticateUser, async (req, res) => {
  try {
    const data = req.body;
    const id = await db.createApplication({
      name: data.name || '',
      contact: data.contact || '',
      address: data.address || '',
      category: data.category || '',
      otherCategoryText: data.otherCategoryText || '',
      description: data.description || '',
      datetime: data.datetime || '',
      price: data.price || '',
      created_at: new Date().toISOString(),
      user_id: req.userId
    });
    console.log('New application created:', id, 'by user:', req.userId);
    res.json({ success: true, id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get current user's applications (authenticated)
app.get('/api/applications/my', authenticateUser, async (req, res) => {
  try {
    const rows = await db.getApplicationsByUserId(req.userId);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Public list of vacancies (for seekers)
app.get('/api/applications/public', async (req, res) => {
  try {
    const rows = await db.getAllApplications();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: get all applications (requires admin key)
app.get('/api/admin/applications', async (req, res) => {
  const key = req.header('x-admin-key') || req.query.adminKey;
  if (!key || key !== ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const rows = await db.getAllApplications();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: get single application
app.get('/api/admin/applications/:id', async (req, res) => {
  const key = req.header('x-admin-key') || req.query.adminKey;
  if (!key || key !== ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const row = await db.getApplicationById(req.params.id);
    res.json(row || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin export CSV
app.get('/api/admin/export', async (req, res) => {
  const key = req.header('x-admin-key') || req.query.adminKey;
  if (!key || key !== ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const rows = await db.getAllApplications();
    const header = 'id,name,contact,address,category,otherCategoryText,description,datetime,price,created_at\n';
    const csv = rows.map(r => [r.id, escapeCsv(r.name), escapeCsv(r.contact), escapeCsv(r.address), escapeCsv(r.category), escapeCsv(r.otherCategoryText), escapeCsv(r.description), escapeCsv(r.datetime), escapeCsv(r.price), r.created_at].join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="tokmaker_applications.csv"');
    res.send(header + csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update application (requires authentication and ownership)
app.put('/api/applications/:id', authenticateUser, async (req, res) => {
  try {
    // Check ownership
    const existing = await db.getApplicationById(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Заявка не найдена' });
    }
    if (existing.user_id !== req.userId) {
      return res.status(403).json({ success: false, error: 'У вас нет прав для редактирования этой заявки' });
    }

    const data = req.body;
    const changes = await db.updateApplication(req.params.id, {
      name: data.name || '',
      contact: data.contact || '',
      category: data.category || '',
      description: data.description || '',
      datetime: data.datetime || '',
      price: data.price || ''
    });
    if (changes === 0) {
      return res.status(404).json({ success: false, error: 'Application not found' });
    }
    console.log('Application updated:', req.params.id, 'by user:', req.userId);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete application (requires authentication and ownership)
app.delete('/api/applications/:id', authenticateUser, async (req, res) => {
  try {
    console.log('DELETE request received for ID:', req.params.id, 'by user:', req.userId);

    // Check ownership
    const existing = await db.getApplicationById(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Заявка не найдена' });
    }
    if (existing.user_id !== req.userId) {
      return res.status(403).json({ success: false, error: 'У вас нет прав для удаления этой заявки' });
    }

    const changes = await db.deleteApplication(req.params.id);
    if (changes === 0) {
      return res.status(404).json({ success: false, error: 'Application not found' });
    }
    console.log('Application deleted successfully:', req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Auth: register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: 'Missing fields' });
    }

    const user = await db.getUserByEmail(email);
    if (user) {
      return res.status(400).json({ success: false, error: 'Email already exists' });
    }

    const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');
    const userId = await db.createUser({ name, email, password: hashedPassword });

    const token = crypto.randomBytes(32).toString('hex');
    await db.createSession(userId, token);

    console.log('User registered:', email);
    res.json({
      success: true,
      token,
      user: { id: userId, name, email }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Auth: login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Missing fields' });
    }

    const user = await db.getUserByEmail(email);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');
    if (user.password !== hashedPassword) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    await db.createSession(user.id, token);

    console.log('User logged in:', email);
    res.json({
      success: true,
      token,
      user: { id: user.id, name: user.name, email: user.email }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Catch-all 404 handler (ВАЖНО: должен быть ПОСЛЕ всех остальных routes)
app.use((req, res) => {
  console.log('404 - Not found:', req.method, req.path);
  res.status(404).json({ error: 'Endpoint not found', path: req.path, method: req.method });
});

function escapeCsv(s) {
  if (s == null) return '';
  return '"' + String(s).replace(/"/g, '""') + '"';
}

app.listen(PORT, () => {
  console.log(`TokMaker server running on http://localhost:${PORT}`);
  console.log('ADMIN_KEY=' + ADMIN_KEY);
});

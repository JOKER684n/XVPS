'use strict';

const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'song-host.sqlite');
const fs = require('fs');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  console.error('SESSION_SECRET must be set to a random value of at least 32 characters.');
  process.exit(1);
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','blocked')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS server_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    template TEXT NOT NULL,
    ram_mb INTEGER NOT NULL,
    cpu_units INTEGER NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
    admin_note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TEXT
  );
`);

const userByEmail = db.prepare('SELECT * FROM users WHERE email = ?');
const userById = db.prepare('SELECT id, name, email, role, status, created_at FROM users WHERE id = ?');

async function bootstrapAdmin() {
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || '');
  if (!email || password.length < 12) {
    console.warn('Admin bootstrap skipped: set ADMIN_EMAIL and ADMIN_PASSWORD (12+ characters) in Railway variables.');
    return;
  }
  const existing = userByEmail.get(email);
  if (!existing) {
    const hash = await bcrypt.hash(password, 12);
    db.prepare("INSERT INTO users (name,email,password_hash,role,status) VALUES (?,?,?,?,?)")
      .run('SONG HOST Admin', email, hash, 'admin', 'active');
    console.log('SONG HOST admin account created from environment.');
  } else if (existing.role !== 'admin') {
    db.prepare("UPDATE users SET role='admin', status='active' WHERE id=?").run(existing.id);
    console.log('Configured admin account role updated.');
  }
}

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"]
    }
  }
}));
app.use(express.json({ limit: '32kb' }));
app.use(express.urlencoded({ extended: false, limit: '16kb' }));
app.use(session({
  name: 'songhost.sid',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 12
  }
}));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: 'draft-7', legacyHeaders: false });
const requestLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 8, standardHeaders: 'draft-7', legacyHeaders: false });

function safeUser(id) {
  return userById.get(id) || null;
}
function requireAuth(req, res, next) {
  const user = req.session.userId ? safeUser(req.session.userId) : null;
  if (!user || user.status !== 'active') {
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'سجّل الدخول بحساب مفعّل للمتابعة.' });
  }
  req.user = user;
  next();
}
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'الصلاحية دي للمدير فقط.' });
  next();
}
function csrf(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const token = req.get('x-songhost-csrf');
  if (!token || !req.session.csrfToken || token !== req.session.csrfToken) {
    return res.status(403).json({ error: 'انتهت صلاحية الطلب. حدّث الصفحة وحاول تاني.' });
  }
  next();
}
app.use('/api', csrf);

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'SONG HOST' }));

app.post('/api/auth/register', authLimiter, async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (name.length < 2 || name.length > 48) return res.status(400).json({ error: 'اكتب اسم من 2 إلى 48 حرف.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 190) return res.status(400).json({ error: 'البريد الإلكتروني غير صحيح.' });
  if (password.length < 10 || password.length > 128) return res.status(400).json({ error: 'كلمة المرور لازم تكون 10 أحرف على الأقل.' });
  if (userByEmail.get(email)) return res.status(409).json({ error: 'البريد ده مسجل بالفعل.' });
  const hash = await bcrypt.hash(password, 12);
  const result = db.prepare("INSERT INTO users (name,email,password_hash,status) VALUES (?,?,?,'pending')").run(name, email, hash);
  res.status(201).json({ ok: true, message: 'تم إنشاء الحساب. الحساب محتاج موافقة الإدارة قبل تسجيل الدخول.', userId: result.lastInsertRowid });
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = userByEmail.get(email);
  const valid = user && await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'البريد أو كلمة المرور غير صحيحة.' });
  if (user.status === 'pending') return res.status(403).json({ error: 'حسابك لسه مستني موافقة الإدارة.' });
  if (user.status === 'blocked') return res.status(403).json({ error: 'الحساب موقوف. تواصل مع الإدارة.' });
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'تعذر بدء الجلسة.' });
    req.session.userId = user.id;
    req.session.csrfToken = require('crypto').randomBytes(32).toString('hex');
    req.session.save(() => res.json({ ok: true, user: safeUser(user.id), csrfToken: req.session.csrfToken }));
  });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.json({ user: null, csrfToken: null });
  const user = safeUser(req.session.userId);
  if (!user || user.status !== 'active') return res.json({ user: null, csrfToken: null });
  if (!req.session.csrfToken) req.session.csrfToken = require('crypto').randomBytes(32).toString('hex');
  res.json({ user, csrfToken: req.session.csrfToken });
});

app.get('/api/dashboard', requireAuth, (req, res) => {
  const mine = db.prepare('SELECT id,name,template,ram_mb,cpu_units,note,status,admin_note,created_at FROM server_requests WHERE user_id=? ORDER BY id DESC').all(req.user.id);
  const stats = {
    requests: mine.length,
    approved: mine.filter(x => x.status === 'approved').length,
    pending: mine.filter(x => x.status === 'pending').length
  };
  res.json({ user: req.user, servers: mine, stats });
});

app.post('/api/servers/request', requireAuth, requestLimiter, (req, res) => {
  const name = String(req.body.name || '').trim();
  const template = String(req.body.template || '');
  const note = String(req.body.note || '').trim().slice(0, 300);
  const ram = Number(req.body.ram);
  const cpu = Number(req.body.cpu);
  const templates = ['node20', 'python311', 'static'];
  if (name.length < 3 || name.length > 32 || !/^[\p{L}\p{N} _-]+$/u.test(name)) return res.status(400).json({ error: 'اسم السيرفر من 3 إلى 32 حرف أو رقم.' });
  if (!templates.includes(template)) return res.status(400).json({ error: 'نوع السيرفر غير مدعوم.' });
  if (![512,1024,2048].includes(ram) || ![1,2].includes(cpu)) return res.status(400).json({ error: 'اختار موارد من الخيارات المتاحة.' });
  const pendingCount = db.prepare("SELECT COUNT(*) AS n FROM server_requests WHERE user_id=? AND status='pending'").get(req.user.id).n;
  if (pendingCount >= 3) return res.status(429).json({ error: 'عندك 3 طلبات مستنية المراجعة بالفعل.' });
  const result = db.prepare("INSERT INTO server_requests (user_id,name,template,ram_mb,cpu_units,note) VALUES (?,?,?,?,?,?)")
    .run(req.user.id, name, template, ram, cpu, note);
  res.status(201).json({ ok: true, id: result.lastInsertRowid, message: 'طلبك اتبعت للإدارة. مش هيتجهز أي سيرفر قبل الموافقة.' });
});

app.get('/api/admin/overview', requireAuth, requireAdmin, (req, res) => {
  const counts = {
    users: db.prepare('SELECT COUNT(*) n FROM users').get().n,
    pendingUsers: db.prepare("SELECT COUNT(*) n FROM users WHERE status='pending'").get().n,
    requests: db.prepare('SELECT COUNT(*) n FROM server_requests').get().n,
    pendingRequests: db.prepare("SELECT COUNT(*) n FROM server_requests WHERE status='pending'").get().n
  };
  const users = db.prepare('SELECT id,name,email,role,status,created_at FROM users ORDER BY id DESC LIMIT 100').all();
  const requests = db.prepare(`SELECT r.*,u.name AS user_name,u.email AS user_email
    FROM server_requests r JOIN users u ON u.id=r.user_id
    ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.id DESC LIMIT 100`).all();
  res.json({ counts, users, requests });
});

app.post('/api/admin/users/:id/approve', requireAuth, requireAdmin, (req, res) => {
  const result = db.prepare("UPDATE users SET status='active' WHERE id=? AND status='pending'").run(Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: 'الحساب مش موجود أو اتراجع قبل كده.' });
  res.json({ ok: true });
});
app.post('/api/admin/users/:id/block', requireAuth, requireAdmin, (req, res) => {
  if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: 'مينفعش توقف حسابك الحالي.' });
  const result = db.prepare("UPDATE users SET status='blocked' WHERE id=? AND role!='admin'").run(Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: 'الحساب غير موجود أو لا يمكن إيقافه.' });
  res.json({ ok: true });
});
app.post('/api/admin/requests/:id/review', requireAuth, requireAdmin, (req, res) => {
  const decision = String(req.body.decision || '');
  const note = String(req.body.note || '').trim().slice(0, 300);
  if (!['approved','rejected'].includes(decision)) return res.status(400).json({ error: 'قرار المراجعة غير صحيح.' });
  const result = db.prepare("UPDATE server_requests SET status=?,admin_note=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'")
    .run(decision, note, Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: 'الطلب مش موجود أو تمت مراجعته.' });
  res.json({ ok: true, message: decision === 'approved' ? 'تمت الموافقة على الطلب.' : 'تم رفض الطلب.' });
});

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

bootstrapAdmin().then(() => {
  app.listen(PORT, '0.0.0.0', () => console.log('SONG HOST listening on ' + PORT));
}).catch((err) => {
  console.error('SONG HOST startup failed:', err);
  process.exit(1);
});

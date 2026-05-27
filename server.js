// ============================================================
// 🔥 Divide o Churras - Backend
// ============================================================
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const IS_PROD = process.env.NODE_ENV === 'production';
const COOKIE_NAME = 'churras_token';
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias
const BCRYPT_ROUNDS = 10;

if (!JWT_SECRET) {
  console.error('FATAL: variável de ambiente JWT_SECRET não definida.');
  console.error('Defina JWT_SECRET no Railway (ex: openssl rand -hex 32) antes de subir.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

app.use(express.static('public', {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('service-worker.js')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
    if (filePath.endsWith('manifest.json')) {
      res.setHeader('Content-Type', 'application/manifest+json');
    }
  }
}));

// ============================================================
// SCHEMA
// ============================================================
async function initDb() {
  // Legacy: estado único do app (mantido durante a transição)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      id INTEGER PRIMARY KEY DEFAULT 1,
      data JSONB NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW(),
      CONSTRAINT single_row CHECK (id = 1)
    );
  `);
  const r = await pool.query('SELECT id FROM app_state WHERE id = 1');
  if (r.rows.length === 0) {
    await pool.query(
      `INSERT INTO app_state (id, data) VALUES (1, $1)`,
      [JSON.stringify({ pessoas: [], churrascos: [], churrasAtivo: null })]
    );
  }

  // Multi-tenant: usuários
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      whatsapp VARCHAR(20) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      security_question TEXT NOT NULL,
      security_answer_hash TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // Pessoas pertencentes a cada usuário (id TEXT preserva os ids
  // gerados pelo frontend via uid(), evitando remapeamento na migração)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_people (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      nome TEXT NOT NULL,
      telefone TEXT,
      avatar JSONB,
      emoji TEXT,
      divida_acumulada NUMERIC(10,2) DEFAULT 0
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_people_user ON user_people(user_id);`);

  // Churrascos (id TEXT pela mesma razão acima)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS churrascos (
      id TEXT PRIMARY KEY,
      owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      nome TEXT NOT NULL,
      data DATE,
      dados JSONB NOT NULL,
      encerrado BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_churrascos_owner ON churrascos(owner_user_id);`);

  // Permissões de edição
  await pool.query(`
    CREATE TABLE IF NOT EXISTS churras_editors (
      churras_id TEXT NOT NULL REFERENCES churrascos(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (churras_id, user_id)
    );
  `);

  console.log('✓ Schema sincronizado');
}

// ============================================================
// AUTH HELPERS
// ============================================================
function normalizeWhatsapp(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\D/g, '');
}

function signToken(user) {
  return jwt.sign({ sub: user.id, whatsapp: user.whatsapp }, JWT_SECRET, { expiresIn: '30d' });
}

function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    maxAge: COOKIE_MAX_AGE_MS,
    path: '/'
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

async function loadUserFromRequest(req) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) return null;
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (_e) {
    return null;
  }
  const r = await pool.query(
    'SELECT id, whatsapp, security_question, created_at FROM users WHERE id = $1',
    [payload.sub]
  );
  return r.rows[0] || null;
}

async function requireAuth(req, res, next) {
  try {
    const user = await loadUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'não autenticado' });
    req.user = user;
    next();
  } catch (e) {
    console.error('requireAuth error:', e);
    res.status(500).json({ error: e.message });
  }
}

// ============================================================
// AUTH ENDPOINTS
// ============================================================
app.post('/api/auth/register', async (req, res) => {
  try {
    const { password, securityQuestion, securityAnswer } = req.body || {};
    const whatsapp = normalizeWhatsapp(req.body && req.body.whatsapp);

    if (!whatsapp || whatsapp.length < 10) {
      return res.status(400).json({ error: 'whatsapp inválido (informe com DDD, só números)' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'senha deve ter ao menos 6 caracteres' });
    }
    if (!securityQuestion || !securityAnswer) {
      return res.status(400).json({ error: 'pergunta e resposta de segurança obrigatórias' });
    }

    const existing = await pool.query('SELECT id FROM users WHERE whatsapp = $1', [whatsapp]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'já existe uma conta com esse whatsapp' });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const answerHash = await bcrypt.hash(String(securityAnswer).trim().toLowerCase(), BCRYPT_ROUNDS);

    const r = await pool.query(
      `INSERT INTO users (whatsapp, password_hash, security_question, security_answer_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, whatsapp, security_question, created_at`,
      [whatsapp, passwordHash, securityQuestion, answerHash]
    );
    const user = r.rows[0];
    setAuthCookie(res, signToken(user));
    res.status(201).json({ user });
  } catch (e) {
    console.error('POST /api/auth/register error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { password } = req.body || {};
    const whatsapp = normalizeWhatsapp(req.body && req.body.whatsapp);
    if (!whatsapp || !password) {
      return res.status(400).json({ error: 'whatsapp e senha obrigatórios' });
    }
    const r = await pool.query(
      'SELECT id, whatsapp, password_hash, security_question, created_at FROM users WHERE whatsapp = $1',
      [whatsapp]
    );
    const row = r.rows[0];
    if (!row) return res.status(401).json({ error: 'whatsapp ou senha incorretos' });

    const ok = await bcrypt.compare(password, row.password_hash);
    if (!ok) return res.status(401).json({ error: 'whatsapp ou senha incorretos' });

    const user = {
      id: row.id,
      whatsapp: row.whatsapp,
      security_question: row.security_question,
      created_at: row.created_at
    };
    setAuthCookie(res, signToken(user));
    res.json({ user });
  } catch (e) {
    console.error('POST /api/auth/login error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/auth/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

app.get('/api/auth/me', async (req, res) => {
  try {
    const user = await loadUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'não autenticado' });
    res.json({ user });
  } catch (e) {
    console.error('GET /api/auth/me error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Etapa 1 do fluxo de recuperação: dado um whatsapp, devolve a pergunta de segurança
app.post('/api/auth/recover/question', async (req, res) => {
  try {
    const whatsapp = normalizeWhatsapp(req.body && req.body.whatsapp);
    if (!whatsapp) return res.status(400).json({ error: 'whatsapp obrigatório' });
    const r = await pool.query('SELECT security_question FROM users WHERE whatsapp = $1', [whatsapp]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'whatsapp não encontrado' });
    res.json({ securityQuestion: r.rows[0].security_question });
  } catch (e) {
    console.error('POST /api/auth/recover/question error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Etapa 2: responde a pergunta e define nova senha
app.post('/api/auth/recover/reset', async (req, res) => {
  try {
    const { securityAnswer, newPassword } = req.body || {};
    const whatsapp = normalizeWhatsapp(req.body && req.body.whatsapp);
    if (!whatsapp || !securityAnswer || !newPassword) {
      return res.status(400).json({ error: 'whatsapp, resposta e nova senha obrigatórios' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'nova senha deve ter ao menos 6 caracteres' });
    }
    const r = await pool.query(
      'SELECT id, security_answer_hash FROM users WHERE whatsapp = $1',
      [whatsapp]
    );
    const row = r.rows[0];
    if (!row) return res.status(404).json({ error: 'whatsapp não encontrado' });

    const ok = await bcrypt.compare(String(securityAnswer).trim().toLowerCase(), row.security_answer_hash);
    if (!ok) return res.status(401).json({ error: 'resposta incorreta' });

    const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, row.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/auth/recover/reset error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// LEGACY API (mantida durante a transição multi-tenant)
// ============================================================
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date() }));

app.get('/api/state', async (req, res) => {
  try {
    const r = await pool.query('SELECT data, updated_at FROM app_state WHERE id = 1');
    res.json({ state: r.rows[0].data, updatedAt: r.rows[0].updated_at });
  } catch (e) {
    console.error('GET /api/state error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/state', async (req, res) => {
  try {
    const { state } = req.body;
    if (!state) return res.status(400).json({ error: 'state obrigatório' });
    await pool.query(
      `UPDATE app_state SET data = $1, updated_at = NOW() WHERE id = 1`,
      [JSON.stringify(state)]
    );
    res.json({ ok: true, updatedAt: new Date() });
  } catch (e) {
    console.error('PUT /api/state error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Stub usado nos próximos commits; já exposto pra checar autenticação no client
app.get('/api/me/ping', requireAuth, (req, res) => {
  res.json({ ok: true, userId: req.user.id });
});

// ============================================================
// FALLBACK SPA
// ============================================================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================================
// START
// ============================================================
initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🔥 Servidor rodando na porta ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Falha ao inicializar:', err);
    process.exit(1);
  });

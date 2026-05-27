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
  // app_state legacy descontinuado na Fase 3 — frontend já saiu do blob global
  await pool.query(`DROP TABLE IF EXISTS app_state;`);

  // Usuários (sua conta criada na Fase 2 fica intacta)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      whatsapp VARCHAR(20) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      security_question TEXT NOT NULL,
      security_answer_hash TEXT NOT NULL,
      ui_state JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ui_state JSONB NOT NULL DEFAULT '{}';`);

  // user_people e churrascos vão receber PK composta — schema novo.
  // Em prod estão vazias (nada escrevia nelas até agora), então drop é seguro.
  // CASCADE garante que churras_editors cai junto.
  await pool.query(`DROP TABLE IF EXISTS churras_editors;`);
  await pool.query(`DROP TABLE IF EXISTS user_people;`);
  await pool.query(`DROP TABLE IF EXISTS churrascos;`);

  // PK composta (user_id, id) — ids gerados pelo client (uid()) ficam
  // isolados por usuário, eliminando risco de colisão cross-user.
  await pool.query(`
    CREATE TABLE user_people (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      nome TEXT NOT NULL,
      telefone TEXT,
      avatar JSONB,
      emoji TEXT,
      divida_acumulada NUMERIC(10,2) NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, id)
    );
  `);

  // churrascos.id continua único global para suportar URLs públicas /churras/:id (Fase 4)
  await pool.query(`
    CREATE TABLE churrascos (
      id TEXT PRIMARY KEY,
      owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      nome TEXT NOT NULL,
      data DATE,
      dados JSONB NOT NULL,
      encerrado BOOLEAN NOT NULL DEFAULT FALSE,
      ativo BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_churrascos_owner ON churrascos(owner_user_id);`);

  await pool.query(`
    CREATE TABLE churras_editors (
      churras_id TEXT NOT NULL REFERENCES churrascos(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (churras_id, user_id)
    );
  `);

  console.log('✓ Schema sincronizado (Fase 3 multi-tenant)');
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
// STATE API (multi-tenant — Fase 3)
// ============================================================
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date() }));

// Monta o blob de estado esperado pelo frontend a partir das tabelas
// do usuário logado. Mantém a mesma wire shape do legacy:
//   { state: { pessoas, churrascos, churrasAtivo, pagamentoAtual }, updatedAt }
app.get('/api/state', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const [peopleR, churrasR, userR] = await Promise.all([
      pool.query(
        `SELECT id, nome, telefone, avatar, emoji, divida_acumulada
         FROM user_people WHERE user_id = $1 ORDER BY nome`,
        [userId]
      ),
      pool.query(
        `SELECT id, nome, data, dados, encerrado, ativo, updated_at
         FROM churrascos WHERE owner_user_id = $1 ORDER BY created_at`,
        [userId]
      ),
      pool.query(`SELECT ui_state FROM users WHERE id = $1`, [userId])
    ]);

    const pessoas = peopleR.rows.map(p => ({
      id: p.id,
      nome: p.nome,
      telefone: p.telefone || '',
      avatar: p.avatar || null,
      emoji: p.emoji || null,
      dividaAcumulada: Number(p.divida_acumulada) || 0
    }));

    const churrascos = churrasR.rows.map(c => {
      const d = c.dados || {};
      return {
        id: c.id,
        nome: c.nome,
        data: c.data,
        ativo: !!c.ativo,
        encerrado: !!c.encerrado,
        participantes: d.participantes || [],
        itens: d.itens || [],
        pagamentos: d.pagamentos || [],
        dividasIniciais: d.dividasIniciais || {}
      };
    });

    const ui = (userR.rows[0] && userR.rows[0].ui_state) || {};
    const updatedAt = churrasR.rows.reduce(
      (max, c) => (c.updated_at > max ? c.updated_at : max),
      new Date(0)
    );

    res.json({
      state: {
        pessoas,
        churrascos,
        churrasAtivo: ui.churrasAtivo || null,
        pagamentoAtual: ui.pagamentoAtual || null
      },
      updatedAt
    });
  } catch (e) {
    console.error('GET /api/state error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Full-replace transacional dos dados do usuário. Valida cross-user
// (id de churras pertencente a outro user → 403) antes de qualquer
// escrita. Pessoas usam PK composta (user_id, id) então colisão
// cross-user é impossível por construção.
app.put('/api/state', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { state } = req.body || {};
  if (!state || typeof state !== 'object') {
    return res.status(400).json({ error: 'state obrigatório' });
  }
  const pessoas = Array.isArray(state.pessoas) ? state.pessoas : [];
  const churrascos = Array.isArray(state.churrascos) ? state.churrascos : [];

  // Validação cross-user: qualquer churras.id enviado precisa OU pertencer
  // a este user OU não existir em lugar nenhum. Se pertence a outro user → 403.
  const ids = churrascos.map(c => String(c.id)).filter(Boolean);
  if (ids.length > 0) {
    const conflict = await pool.query(
      `SELECT id FROM churrascos WHERE id = ANY($1::text[]) AND owner_user_id <> $2 LIMIT 1`,
      [ids, userId]
    );
    if (conflict.rows.length > 0) {
      return res.status(403).json({
        error: 'tentativa de escrever em churras de outro usuário',
        churrasId: conflict.rows[0].id
      });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // pessoas: full replace (PK composta isola por user)
    await client.query(`DELETE FROM user_people WHERE user_id = $1`, [userId]);
    for (const p of pessoas) {
      if (!p || !p.id) continue;
      await client.query(
        `INSERT INTO user_people (user_id, id, nome, telefone, avatar, emoji, divida_acumulada)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          userId,
          String(p.id),
          String(p.nome || ''),
          p.telefone || null,
          p.avatar ? JSON.stringify(p.avatar) : null,
          p.emoji || null,
          Number(p.dividaAcumulada) || 0
        ]
      );
    }

    // churrascos: upsert dos enviados + delete dos que sumiram
    for (const c of churrascos) {
      if (!c || !c.id) continue;
      const dados = {
        participantes: c.participantes || [],
        itens: c.itens || [],
        pagamentos: c.pagamentos || [],
        dividasIniciais: c.dividasIniciais || {}
      };
      await client.query(
        `INSERT INTO churrascos (id, owner_user_id, nome, data, dados, encerrado, ativo, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (id) DO UPDATE SET
           nome = EXCLUDED.nome,
           data = EXCLUDED.data,
           dados = EXCLUDED.dados,
           encerrado = EXCLUDED.encerrado,
           ativo = EXCLUDED.ativo,
           updated_at = NOW()
         WHERE churrascos.owner_user_id = $2`,
        [
          String(c.id),
          userId,
          String(c.nome || 'Churras'),
          c.data || null,
          JSON.stringify(dados),
          !!c.encerrado,
          !!c.ativo
        ]
      );
    }

    if (ids.length > 0) {
      await client.query(
        `DELETE FROM churrascos WHERE owner_user_id = $1 AND id <> ALL($2::text[])`,
        [userId, ids]
      );
    } else {
      await client.query(`DELETE FROM churrascos WHERE owner_user_id = $1`, [userId]);
    }

    // ui_state: persiste preferências/UI transitória
    const uiState = {
      churrasAtivo: state.churrasAtivo || null,
      pagamentoAtual: state.pagamentoAtual || null
    };
    await client.query(
      `UPDATE users SET ui_state = $1 WHERE id = $2`,
      [JSON.stringify(uiState), userId]
    );

    await client.query('COMMIT');
    res.json({ ok: true, updatedAt: new Date() });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('PUT /api/state error:', e);
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
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

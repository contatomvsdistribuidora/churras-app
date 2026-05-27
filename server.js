// ============================================================
// 🔥 Divide o Churras - Backend
// ============================================================
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Railway disponibiliza DATABASE_URL automaticamente
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

app.use(cors());
// Permite uploads grandes (comprovantes em base64)
app.use(express.json({ limit: '10mb' }));

// Configuração estática com headers apropriados para PWA
app.use(express.static('public', {
  setHeaders: (res, filePath) => {
    // Service worker não deve ser cacheado (sempre buscar a versão mais nova)
    if (filePath.endsWith('service-worker.js')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
    // Manifest com MIME type correto
    if (filePath.endsWith('manifest.json')) {
      res.setHeader('Content-Type', 'application/manifest+json');
    }
  }
}));

// ============================================================
// SETUP DO BANCO (cria tabela se não existir)
// ============================================================
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      id INTEGER PRIMARY KEY DEFAULT 1,
      data JSONB NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW(),
      CONSTRAINT single_row CHECK (id = 1)
    );
  `);

  // Garante que existe pelo menos uma linha
  const r = await pool.query('SELECT id FROM app_state WHERE id = 1');
  if (r.rows.length === 0) {
    await pool.query(
      `INSERT INTO app_state (id, data) VALUES (1, $1)`,
      [JSON.stringify({ pessoas: [], churrascos: [], churrasAtivo: null })]
    );
  }
  console.log('✓ Banco inicializado');
}

// ============================================================
// API
// ============================================================

// Health check
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date() }));

// GET /api/state - retorna todo o estado
app.get('/api/state', async (req, res) => {
  try {
    const r = await pool.query('SELECT data, updated_at FROM app_state WHERE id = 1');
    res.json({
      state: r.rows[0].data,
      updatedAt: r.rows[0].updated_at
    });
  } catch (e) {
    console.error('GET /api/state error:', e);
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/state - salva o estado inteiro
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

// Fallback - serve index.html para qualquer rota não-API
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================================
// START
// ============================================================
i

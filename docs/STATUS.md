# Status do Projeto — Divide o Churras

Última atualização: 2026-05-27

---

## 1. Onde estamos agora

| Fase | O que entrega | Estado |
|---|---|---|
| 0 | App inicial: Express + PostgreSQL + JSONB global, sem login | ✅ em produção |
| 1 | Schema multi-tenant + endpoints de auth (`/api/auth/*`) | ✅ em produção (commit `f050b5a`) |
| 2 | Frontend de login/cadastro/recuperação de senha | ✅ em produção e **testada por você** (commit `a12298e`) |
| 3 | Multi-tenancy real nos endpoints `/api/state` | ⚠️ **commitada e no `main` (`8fcc888`), mas ainda NÃO testada em produção** |
| 4 | Participantes por churras + URL pública + permissões de edição | ⏳ não iniciada |
| v2 | Reformulação completa (perfil → grupos → eventos → gastos → fotos) | 📐 em design — ver [ROADMAP-V2.md](./ROADMAP-V2.md) |

> **Pause da Fase 3 pra retomada (2026-05-27):** o código da Fase 3 está commitado e enviado pro GitHub, mas você decidiu pausar antes de deployar pra repensar a estratégia em favor de um possível v2. Decisões pendentes:
> - Deployar a Fase 3 como está e seguir pra Fase 4?
> - Reverter a Fase 3 e pular direto pro v2?
> - Manter Fase 3 deployada e construir o v2 em paralelo?

---

## 2. O que está funcionando hoje em produção

A versão atualmente rodando no Railway é a **Fase 2**:

- ✅ App carrega, cadastro/login/logout/recuperação de senha funcionando
- ✅ Cookie JWT httpOnly + SameSite=Lax, sessão de 30 dias
- ✅ Pergunta de segurança no cadastro (dropdown com 7 opções)
- ✅ Recuperação de senha em 2 etapas (busca pergunta pelo WhatsApp → resposta + nova senha)
- ✅ Botão "Sair" no topo
- ✅ Gate de auth: sem cookie → redireciona pro login
- ✅ Funcionalidade original do app (criar churras, adicionar pessoas, gastos, dividir conta) preservada
- ✅ PWA continua funcionando (manifest, service worker)

---

## 3. O que NÃO está funcionando ainda em produção

⚠️ **Multi-tenancy real**: na versão deployada (Fase 2), o app continua usando os endpoints `GET/PUT /api/state` legados, que leem e escrevem na tabela `app_state` global. **Todos os usuários logados compartilham os mesmos dados.** Isso quer dizer:

- Usuário A cria uma pessoa "Maca" → Usuário B também vê "Maca"
- Usuário B adiciona um churras → Usuário A também vê
- Não há nenhum isolamento de dados entre contas

A Fase 3 resolveu isso no código (`main` atual), mas o deploy não foi promovido.

---

## 4. URLs importantes

- **GitHub:** https://github.com/contatomvsdistribuidora/churras-app
- **Branch atual:** `main`
- **Último commit:** `8fcc888` — `feat(api): fase 3 — multi-tenancy real em GET/PUT /api/state`
- **Railway:** deploy automático a partir de push no `main` (URL específica está no painel do Railway — não documentada aqui pra evitar leak de URLs internas)

---

## 5. Variáveis de ambiente configuradas no Railway

(apenas nomes — valores estão no painel do Railway)

| Nome | Obrigatória? | Pra quê |
|---|---|---|
| `DATABASE_URL` | sim (injetada pelo Railway Postgres) | conexão com o banco |
| `JWT_SECRET` | sim — servidor recusa subir sem ela | assinar tokens JWT (gerar com `openssl rand -hex 32`) |
| `NODE_ENV` | recomendada (`production`) | ativa cookie `secure: true` em HTTPS |
| `PORT` | injetada pelo Railway | porta que o Express escuta |

Variáveis que **não estão mais em uso** (eram da migração legacy descontinuada — pode remover do Railway se ainda existirem):
- `MIGRATE_WHATSAPP`
- `MIGRATE_PASSWORD`

---

## 6. Estrutura do código hoje

```
/
├── server.js             # Express + Postgres + auth + endpoints (~430 linhas)
├── package.json          # deps: express, pg, cors, bcryptjs, jsonwebtoken, cookie-parser
├── package-lock.json
├── railway.json          # config de deploy do Railway
├── .gitignore
├── public/
│   ├── index.html        # SPA monolítico (~1500 linhas, inclui CSS, HTML, JS, auth UI)
│   ├── manifest.json     # PWA
│   └── service-worker.js # cache offline
└── docs/                 # esta pasta — apenas documentação
    ├── STATUS.md         # este arquivo
    └── ROADMAP-V2.md     # visão do produto v2
```

---

## 7. Schema do banco (estado da Fase 3 no `main`)

```sql
users (
  id SERIAL PRIMARY KEY,
  whatsapp VARCHAR(20) UNIQUE,
  password_hash TEXT,
  security_question TEXT,
  security_answer_hash TEXT,
  ui_state JSONB DEFAULT '{}',     -- preferências do user (churrasAtivo, pagamentoAtual)
  created_at TIMESTAMP
)

user_people (
  user_id INT,                      -- PK composta evita colisão entre users
  id TEXT,
  nome, telefone, avatar, emoji,
  divida_acumulada NUMERIC,
  PRIMARY KEY (user_id, id)
)

churrascos (
  id TEXT PRIMARY KEY,              -- único global pra suportar /churras/:id (Fase 4)
  owner_user_id INT,
  nome, data, dados JSONB,
  encerrado, ativo,
  created_at, updated_at
)

churras_editors (
  churras_id TEXT,
  user_id INT,
  PRIMARY KEY (churras_id, user_id)
)
```

A tabela legacy `app_state` foi dropada na Fase 3 (`DROP TABLE IF EXISTS` no boot). Quando você decidir deployar a Fase 3, todos os dados antigos (Maca, Junior, Alemão, Marcio, Felipe, Vini) somem — você já confirmou que está OK.

---

## 8. Próximo passo planejado (Fase 3) — o que ela faz

A Fase 3 já está no código (`main`), e quando promovida pra produção:

- Faz `DROP TABLE IF EXISTS app_state` no boot (apaga dados antigos)
- Substitui `GET/PUT /api/state` por versões que filtram por `user_id` do JWT
- Cada usuário vê **só seus próprios dados** (pessoas, churrascos, gastos)
- Cross-user write protection: tentativa de gravar churras de outro user → HTTP 403
- Transação BEGIN/COMMIT na escrita; rollback automático em erro
- Frontend visualmente igual — só a fonte dos dados muda

Quando deployar:
1. Você loga na sua conta → app fica **vazio** (esperado — começo do zero)
2. Cria pessoas e um churras → reaparecem ao recarregar
3. Cria uma segunda conta (outro número) → app continua vazio (sem dados da primeira)

---

## 9. Comandos úteis pra retomar amanhã

### Abrir o ambiente
- Codespace: GitHub → este repositório → botão "Code" → aba "Codespaces" → abrir o existente (ou criar novo)
- Working dir do Codespace: `/workspaces/churras-app`

### Rodar o Claude Code
```bash
claude
```
Dentro do Claude: digite as instruções normalmente. Pra retomar, comece dizendo "li o docs/STATUS.md e o docs/ROADMAP-V2.md" — ele vai ler os dois e ter contexto completo.

### Ver logs do Railway
- Pelo painel web: railway.app → seu projeto → serviço → aba "Deployments" → clica no deploy → "View logs"
- Pela CLI (se tiver instalada):
  ```bash
  railway login
  railway logs --service <nome-do-servico>
  ```

### Ver o estado do git
```bash
git log --oneline -10
git status
```

### Rodar o servidor localmente (precisa de Postgres)
```bash
export JWT_SECRET=$(openssl rand -hex 32)
export DATABASE_URL=postgres://user:pass@localhost:5432/churras
npm install
npm start
```

### Reverter a Fase 3 (se decidir não usar)
```bash
git revert 8fcc888
git push origin main
```

---

## 10. Próximos passos sugeridos pra você decidir

1. **Ler [ROADMAP-V2.md](./ROADMAP-V2.md)** — visão de produto baseada nas suas ideias
2. **Decidir a estratégia:**
   - Deployar Fase 3 + Fase 4 (multi-tenancy + URL pública) e só depois pensar no v2?
   - Pular pra v2 direto, reaproveitando o que dá da Fase 3?
   - Algum caminho híbrido?
3. **Responder as perguntas em aberto do ROADMAP-V2** (seção "Decisões em Aberto") pra eu poder planejar com você
4. Se for seguir pra Fase 4, me dizer: "vamos pra Fase 4" e eu retomo do plano de participantes-por-churras

# Roadmap v2 — Divide o Churras

Última atualização: 2026-05-27
Status: 📐 **design — nada implementado ainda**

---

## Visão original do usuário (transcrição literal)

> "na tela inicial seria o perfil da pessoa, aonde vai ter os grupo que ela pode participar, por exemplo clube, empresa, viagem em familia, etc. Cada grupo pode adicionar pessoas que irão fazer parte do grupo, mais de uma pessoa pode fazer parte de varios grupos.
>
> Na tela principal vai ter o dashboard dos eventos criados, participados, aonde foi, como foi. Cada evento pode ter a opção de verificar quem pagou, quanto foi, etc. Cada evento vai ter a opção de colocar fotos do que aconteceu no evento e enviar para as pessoas que participaram.
>
> No painel principal vai ter a opção de criar novo evento (ex: churras do clube). Ai no evento coloca os dados do evento, o grupo de pessoas que irá participar, pode colocar pessoas fora do grupo ou incluir no grupo. Colocando todos os participantes, pode editar tirando e colocando. A pessoa colocada como participante, se ela tiver o app, pode editar sua foto e algumas outras coisas que ficará compartilhado entre todos.
>
> Feito o cadastro de todo evento, vamos selecionar as pessoas do evento e colocar os gastos de cada, e descrição do que foi feito. Pode ter mais de uma pessoa que gastou. Após colocando todos os custos, o sistema calcula e divide para todos os participantes. Quem tem o app já aparece lá, ou compartilhamos para todos do grupo. Todos ficam devendo, conforme for pagando as pessoas enviam o comprovante em anexo do grupo para e o sistema vai dar baixa como pago, até todas as pessoas pagarem.
>
> Os dados da conta serão pré-cadastrados para quando tiver que pagar fica fácil para cada um verificar."

---

## 1. Visão Geral

O **v2 do Divide o Churras** muda o modelo mental de "uma conta global por usuário" pra um sistema com 3 níveis hierárquicos: **Perfil → Grupos → Eventos**.

Cada pessoa tem um perfil, participa de um ou mais grupos (clube, família, empresa, viagem), e dentro de cada grupo organiza eventos (churras, jantar, viagem). Cada evento tem participantes (do grupo ou avulsos), gastos divididos, comprovantes de pagamento e galeria de fotos.

A diferença prática: ao invés de cada usuário ter seu próprio "app isolado", o app vira um espaço **colaborativo** onde a mesma pessoa aparece em vários contextos sociais, e quem participa de um evento consegue contribuir (foto, gasto, pagamento) ao invés de ser só "controlado" por uma pessoa.

---

## 2. Conceitos Principais

| Conceito | O que é | Notas |
|---|---|---|
| **Perfil** | Conta de usuário do app (1 WhatsApp = 1 perfil) | Equivalente ao `users` da v1 |
| **Grupo** | Coleção nomeada de pessoas (clube, família, empresa) | N:N com perfis (membros) |
| **Membro de Grupo** | Vínculo perfil ↔ grupo, com papel (admin/membro) | Quem pode convidar, criar eventos, etc |
| **Pessoa não-cadastrada** | Participante que ainda não tem perfil no app | Tem nome + opcionalmente telefone; pode ser "promovida" a perfil depois |
| **Evento** | Acontecimento dentro de um grupo (churras, viagem) | Tem data, local, descrição, fotos |
| **Participante de Evento** | Quem foi no evento (pode ser perfil ou pessoa não-cadastrada) | Pode ser de fora do grupo |
| **Gasto** | Item pago por alguém no contexto do evento | Quem pagou, quanto, descrição |
| **Pagamento** | Transferência de devedor → credor | Com anexo de comprovante (foto) |
| **Comprovante** | Imagem do comprovante de pagamento (PIX, etc) | Marca pagamento como "confirmado" |
| **Dados Bancários** | Conta/PIX pré-cadastrado de um perfil | Mostrado pra quem precisa pagar |
| **Foto de Evento** | Imagem anexada ao evento (não é comprovante) | Galeria, opcionalmente compartilhada por WhatsApp |

---

## 3. Funcionalidades por Tela

### 3.1. Tela de Perfil (home)
- Avatar, nome, WhatsApp
- Lista de grupos do usuário (com badge de eventos pendentes)
- Botão "Criar novo grupo"
- Botão "Entrar em grupo" (via convite)
- Botão "Editar perfil" (foto, nome, dados bancários, PIX)
- Acesso rápido a "minhas dívidas" / "vão me pagar"

### 3.2. Tela de Grupo
- Cabeçalho: nome do grupo, foto, descrição
- Lista de membros (com indicador "tem app" vs "só nome")
- Lista de eventos do grupo (futuros e passados)
- Botão "Criar evento"
- Botão "Convidar membro" (link compartilhável OU busca por WhatsApp)
- Configurações (só admin): renomear, adicionar/remover membros, deletar grupo

### 3.3. Tela de Evento
Provavelmente subdividida em abas:
- **Detalhes:** nome, data, local, descrição, foto de capa
- **Participantes:** quem foi (membros do grupo + avulsos), botão pra adicionar/tirar
- **Gastos:** lista de itens (descrição, quem comprou, valor), botão "Adicionar gasto"
- **Divisão:** quem deve a quem, com botão "Pagar" que abre dados bancários do credor
- **Pagamentos:** lista de pagamentos com comprovantes anexados
- **Galeria:** fotos do evento, botão pra adicionar, opção "Compartilhar no WhatsApp do grupo"

### 3.4. Tela de Dashboard (histórico)
- Lista de eventos passados, ordenada por data
- Filtros: por grupo, por status (pago/aberto), por data
- Cada cartão de evento mostra: nome, data, local, foto de capa, valor total, status de pagamento

### 3.5. Tela de Pagamento / Dados Bancários
- **Quando você é o credor:** veja quem te deve, valor; botão "Cobrar pelo WhatsApp" (gera mensagem)
- **Quando você é o devedor:** veja a quem deve, valor, dados bancários pré-cadastrados (PIX, banco/agência/conta); botão "Enviar comprovante" (upload de imagem) → muda status pra "aguardando confirmação" → credor confirma → vira "pago"

---

## 4. Modelo de Dados Sugerido

> Versão inicial — vai precisar refinar conforme as decisões em aberto forem fechadas.

```sql
-- Perfis (≈ users da v1, com mais campos)
profiles (
  id SERIAL PRIMARY KEY,
  whatsapp VARCHAR(20) UNIQUE NOT NULL,
  nome TEXT NOT NULL,
  avatar JSONB,                         -- estrutura igual à v1
  password_hash TEXT,
  security_question TEXT,
  security_answer_hash TEXT,
  created_at TIMESTAMP DEFAULT NOW()
)

-- Dados bancários por perfil (1 perfil pode ter várias contas)
bank_accounts (
  id SERIAL PRIMARY KEY,
  profile_id INT REFERENCES profiles(id) ON DELETE CASCADE,
  tipo TEXT,                            -- 'pix' | 'conta_bancaria' | 'wallet'
  rotulo TEXT,                          -- 'Itaú principal', 'PIX CPF'
  detalhes JSONB,                       -- { chave_pix, banco, agencia, conta, ... }
  principal BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
)

-- Grupos
groups (
  id TEXT PRIMARY KEY,                  -- nanoid pra URLs
  nome TEXT NOT NULL,
  descricao TEXT,
  avatar JSONB,
  created_by INT REFERENCES profiles(id),
  created_at TIMESTAMP DEFAULT NOW()
)

-- Membros de grupo (N:N entre profiles e groups)
group_members (
  group_id TEXT REFERENCES groups(id) ON DELETE CASCADE,
  profile_id INT REFERENCES profiles(id) ON DELETE CASCADE,
  papel TEXT DEFAULT 'membro',          -- 'admin' | 'membro'
  joined_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (group_id, profile_id)
)

-- Pessoas não-cadastradas pertencentes a um grupo
-- (vínculo flexível: podem ser "promovidas" a profile depois)
group_guests (
  id TEXT,                              -- nanoid
  group_id TEXT REFERENCES groups(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  telefone TEXT,
  avatar JSONB,
  promoted_to_profile_id INT REFERENCES profiles(id),  -- preenchido quando vira perfil
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (group_id, id)
)

-- Eventos
events (
  id TEXT PRIMARY KEY,                  -- nanoid pra URLs
  group_id TEXT REFERENCES groups(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  data DATE,
  local TEXT,
  descricao TEXT,
  capa_url TEXT,                        -- pode ser uma das fotos
  encerrado BOOLEAN DEFAULT FALSE,
  created_by INT REFERENCES profiles(id),
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)

-- Participantes do evento (profile OU guest — discriminado por kind)
event_participants (
  event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
  kind TEXT,                            -- 'profile' | 'guest'
  profile_id INT REFERENCES profiles(id),
  guest_group_id TEXT,
  guest_id TEXT,
  PRIMARY KEY (event_id, kind, COALESCE(profile_id, 0), COALESCE(guest_id, '')),
  FOREIGN KEY (guest_group_id, guest_id) REFERENCES group_guests(group_id, id)
)

-- Gastos do evento
expenses (
  id TEXT PRIMARY KEY,
  event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
  descricao TEXT NOT NULL,
  valor NUMERIC(10,2) NOT NULL,
  -- quem pagou (1 só por gasto na v2; se múltiplos, criar N gastos)
  pago_por_kind TEXT,
  pago_por_profile_id INT REFERENCES profiles(id),
  pago_por_guest_group_id TEXT,
  pago_por_guest_id TEXT,
  created_at TIMESTAMP DEFAULT NOW()
)

-- Pagamentos (devedor → credor)
payments (
  id TEXT PRIMARY KEY,
  event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
  -- de quem (devedor)
  de_kind TEXT, de_profile_id INT, de_guest_group_id TEXT, de_guest_id TEXT,
  -- pra quem (credor)
  para_kind TEXT, para_profile_id INT, para_guest_group_id TEXT, para_guest_id TEXT,
  valor NUMERIC(10,2),
  comprovante_url TEXT,
  status TEXT DEFAULT 'pendente',       -- 'pendente' | 'aguardando_confirmacao' | 'confirmado'
  created_at TIMESTAMP,
  confirmed_at TIMESTAMP
)

-- Galeria de fotos do evento
event_photos (
  id TEXT PRIMARY KEY,
  event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  uploaded_by INT REFERENCES profiles(id),
  legenda TEXT,
  created_at TIMESTAMP
)
```

**Observação chave:** a polimorfia "participante pode ser profile OU guest" é a parte mais delicada do schema. Alternativas a considerar:
- (a) Sempre criar um `guest` mesmo pra quem tem perfil, e linkar perfil → guest. Simplifica FKs mas tem duplicação.
- (b) Tabela única `actors` que une perfis e convidados num único id. Mais limpo, mais refactor.

---

## 5. Diferenças entre v1 e v2

| Aspecto | v1 (atual) | v2 (visão) |
|---|---|---|
| Modelo mental | "minha lista de pessoas e churrascos" | "perfil → grupos → eventos" |
| Pessoas | Lista plana por usuário | Membros de grupos + convidados avulsos |
| Compartilhamento | Nada (ou URL pública na Fase 4) | Cada grupo é compartilhado entre seus membros |
| Edição colaborativa | Não (só dono do churras) | Sim — qualquer membro do grupo edita o evento |
| Fotos do evento | Não existe | Galeria por evento |
| Comprovantes | Imagem em base64 dentro do JSONB | Upload de arquivo + URL (S3/Cloudinary) |
| Dados bancários | Não existe | Pré-cadastrados no perfil, exibidos na hora de pagar |
| Notificações | Nenhuma | Provavelmente sim (decisão em aberto) |
| Granularidade da API | 1 endpoint `/api/state` (blob) | REST por recurso (grupos, eventos, gastos, etc) |
| Armazenamento | Postgres só | Postgres + storage de imagens |
| Pessoa = User? | Não (pessoas são "fantasmas") | Convidados podem virar perfis (linking) |

---

## 6. Decisões em Aberto

Cada uma destas pode mudar bastante a arquitetura — vale pensar com calma antes de implementar.

### 6.1. Como funciona o convite pra grupo?
**Opções:**
- (a) **Link compartilhável** (`/g/abc123/join`) — quem abre o link e está logado entra no grupo
- (b) **Busca por WhatsApp** — admin digita o número, sistema convida (precisa notificar de algum jeito)
- (c) **Ambos** — link aberto + convite direto por WhatsApp

🤔 **A favor de (a):** simples, viral, sem notificações. **A favor de (b):** mais controlado.
**Recomendação inicial:** começar com (a) e adicionar (b) depois se necessário.

### 6.2. Notificações
**Opções:**
- Push notification do navegador / PWA
- Email
- WhatsApp (via API oficial, custosa, ou via link `wa.me`)
- Nenhuma (usuários abrem o app por conta própria)

🤔 **A favor de "nenhuma":** muito mais simples, MVP roda. **A favor de WhatsApp link:** já está no DNA do app.
**Recomendação inicial:** botões "Cobrar pelo WhatsApp" e "Avisar do evento pelo WhatsApp" que geram URLs `wa.me` — usuário escolhe enviar.

### 6.3. Onde armazenar fotos e comprovantes?
**Opções:**
- **Base64 no banco** (como hoje pra comprovantes) — simples mas faz o banco inchar e Railway cobra por GB
- **Cloudinary** — free tier 25 GB/mês, transformações on-the-fly, fácil
- **S3 (AWS / Cloudflare R2)** — barato, mais setup
- **Railway volumes** — fica preso ao Railway, sem CDN

🤔 **Recomendação inicial:** Cloudinary no MVP — barato, sem manutenção, CDN incluso, free tier cabe pra começar.

### 6.4. PIX integrado ou só dados manuais?
**Opções:**
- (a) **Só exibir** dados pré-cadastrados (chave PIX, banco/conta) e o usuário paga manualmente no app do banco. Comprovante: upload de imagem.
- (b) **Integrar PIX** via API de algum provedor (Mercado Pago, Asaas, Stark Bank, etc) — gera QR Code dinâmico, confirma pagamento automaticamente. Mais complexo, custos por transação.

🤔 **A favor de (a):** zero custo, zero compliance, zero integração. **A favor de (b):** UX muito melhor.
**Recomendação inicial:** (a) no MVP; (b) só se virar gargalo real.

### 6.5. O v2 substitui o v1 ou roda em paralelo?
**Opções:**
- (a) **Substitui** — vira a v2.0 no mesmo deploy, mesma URL. Usuários atuais migram (ou começam do zero).
- (b) **Paralelo** — `/v1` continua existindo (legacy), `/v2` é a nova; usuários escolhem
- (c) **Branch separada** — implementa em outra branch, deploy noutro serviço, decide depois

🤔 **A favor de (a):** mais simples, menos código pra manter. **A favor de (b):** dá tempo de testar sem quebrar quem está usando.
**Recomendação inicial:** (a), porque hoje só você está usando — não há "base instalada" pra proteger.

### 6.6. Edição colaborativa: como evitar race conditions?
Múltiplas pessoas editando o mesmo evento ao mesmo tempo. Opções:
- (a) **Last-write-wins** (igual a v1) — simples, racy
- (b) **Optimistic locking** com `version`/`updated_at` — devolve 409 e UI mostra "alguém editou, recarrega?"
- (c) **CRDT / OT** — complexo demais pro escopo

🤔 **Recomendação inicial:** (a) no MVP; (b) quando virar problema.

### 6.7. Quem pode editar o quê?
- Grupo: admin vs membro vs convidado externo?
- Evento: qualquer membro do grupo? Só quem criou? Quem é participante?
- Gasto: só quem adicionou pode editar? Só quem pagou? Qualquer participante?
- Foto: quem subiu pode apagar? Admin do grupo pode apagar qualquer?

🤔 Cada decisão é uma regra a implementar e testar. Sugestão: começar bem permissivo (qualquer membro do grupo edita tudo) e endurecer depois com base em feedback real.

### 6.8. App-side: continuar SPA monolítico ou virar framework?
A v1 é 1 arquivo HTML de 1500 linhas. A v2 vai ter pelo menos 5 telas distintas, navegação, upload de imagem, talvez offline sync.

**Opções:**
- (a) **Continuar HTML monolítico** — 3000 linhas, vanilla JS, fácil de deployar
- (b) **Vite + React/Preact/Svelte** — DX melhor, build step, mais arquivos
- (c) **HTMX + servidor** — server-rendered, simples, sem build

🤔 Tradeoff de manutenibilidade vs simplicidade. Recomendação: avaliar quando o monolítico passar de uns 2000 linhas.

---

## 7. Estratégia de Migração

**Premissa:** você confirmou que dados antigos da v1 podem ser perdidos (sua conta atual já está bem). Não há base de usuários instalada — só você.

**Plano sugerido:**

1. **Implementar v2 em branch separada** (`v2-experimental`) sem afetar o `main`
2. Construir incrementalmente:
   - Fase A: perfil + grupos + membros (sem eventos ainda)
   - Fase B: eventos + participantes
   - Fase C: gastos + cálculo de divisão (porta a lógica do v1)
   - Fase D: pagamentos + comprovantes
   - Fase E: galeria de fotos
   - Fase F: dados bancários
3. Quando v2 estiver utilizável end-to-end, fazer um **deploy paralelo** (segundo serviço no Railway ou subdomínio)
4. Testar com 1-2 pessoas reais (você + um amigo)
5. Quando aprovar, fazer merge na `main` e o v1 some
6. **Não há migração de dados** — começa do zero (escala é trivial)

**Backup do v1:** antes de matar, tag git `v1-final` no último commit do `main` pra poder voltar se precisar.

---

## 8. Estimativa de Esforço

> Estimativas em horas-de-Claude-Code (sessões focadas com você no leme). Cada bloco assume os tradeoffs "Recomendação inicial" acima — se subir de escopo, sobe a estimativa.

| Bloco | Horas | Notas |
|---|---|---|
| **Schema + migrations + helpers de auth (refactor pra v2)** | 2-3h | Reusa muito da v1: bcrypt, JWT, cookie. Schema novo é maior. |
| **CRUD de Perfis + Dados bancários** | 2-3h | Telas + endpoints + validação |
| **CRUD de Grupos + Membros + Convidados** | 4-6h | Lógica de papéis, convite por link, listagem |
| **CRUD de Eventos + Participantes** | 4-6h | Polimorfia profile/guest é a parte chata |
| **Gastos + cálculo de divisão** | 3-4h | Porta a lógica que já existe na v1, adapta pro novo modelo |
| **Pagamentos + comprovantes (com Cloudinary)** | 4-6h | Inclui integração Cloudinary, upload, exibição |
| **Galeria de fotos** | 2-3h | Reusa o setup do Cloudinary |
| **UI/UX polish + responsivo + PWA** | 6-10h | Difícil estimar — depende muito do nível de polish |
| **Testes end-to-end (curl + cypress?)** | 3-5h | Idealmente alguma cobertura automatizada |
| **Deploy paralelo + smoke test em prod** | 1-2h | Configurar segundo serviço Railway, env vars, etc |
| **TOTAL aproximado** | **30-50h** | Spread em 2-4 semanas se uma sessão por dia |

⚠️ Estimativas com 100% de incerteza pra coisas tipo "responsivo + PWA" — usar como ordem de grandeza, não como compromisso.

---

## 9. Próximos passos (pra retomar amanhã)

1. **Ler este documento e o STATUS.md com calma**
2. **Responder as 8 decisões em aberto na Seção 6** — pode ser direto em uma sessão futura ("aqui vão minhas respostas: 6.1 = a, 6.2 = wa.me só, ..."). Posso atualizar o doc.
3. **Decidir o caminho da v1:**
   - Deployar Fase 3 (que já está commitada) antes de partir pra v2?
   - Ou pular Fase 3+4 e ir direto pra v2?
4. **Definir escopo do MVP do v2:** que blocos da Seção 8 entram na v1.0 do v2?
5. Quando topar começar: "vamos começar o v2 pela Fase A (perfil + grupos)" — eu pego daqui

---

## 10. O que NÃO está no escopo deste roadmap (por ora)

Pra deixar claro o que ficou de fora:
- Versão mobile nativa (iOS/Android puro) — PWA continua sendo a estratégia
- Multi-idioma
- Modo claro (mantém só o tema escuro)
- Marketplace / integração com restaurantes / delivery
- Gamificação ("você organizou 10 eventos!")
- Recorrência de eventos ("todo sábado")
- Importação de gastos via foto do recibo (OCR)
- Integração com calendário (Google Calendar)
- Login social (Google, Facebook)

Qualquer um desses pode entrar depois — esta lista é só pra cravar o foco no essencial.

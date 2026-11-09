# REPOSITORY-CLEANUP-2026-11-08

Auditoria e organização do repositório Airsoft Americana.
Data da auditoria: 2026-11-08. Nenhum dado de secret/token/senha/.env é reproduzido aqui.
Nenhum comando foi enviado para remote.

Comandos usados no inventário:

```text
git status --short --ignored
git ls-files
git ls-files --others --exclude-standard
git check-ignore -v <caminhos>
git diff / git diff --stat
git grep -n <referências> (cruzamento de referências)
Get-ChildItem (árvore, tamanhos, datas de modificação)
Get-Content (package.json, README.md, AGENTS.md, scripts .bat/.cmd, configs)
```

---

## 1. INVENTÁRIO INICIAL

### 1.1 Números

| Métrica | Valor |
|---|---|
| Arquivos rastreados pelo Git | 549 |
| Arquivos não rastreados (untracked) | 11 (todos scripts `.bat`/`.cmd` na raiz) |
| Entradas ignoradas pelo Git | 13 (pastas geradas) |
| Workflows CI (`.github/`) | inexistentes no projeto (só dentro de `node_modules`) |
| Tamanho `.git` | ~9,2 MB |
| Tamanho `node_modules/` | ~605 MB |
| Tamanho `apps/` | ~1,5 GB (inclui `.next/` e `node_modules/` de cada app) |
| Tamanho `vitest/` | ~42 MB (quase tudo em `vitest/data-test-root/` — PGlite de teste) |
| Tamanho `data-e2e/` | ~42 MB (banco PGlite do E2E) |
| Tamanho `mirror/` | ~7,6 MB |
| Tamanho `temp_base/` | ~7,6 MB |
| Tamanho `test-results/` | ~125 KB |
| Tamanho `logs/` | ~246 KB |
| Tamanho `docs/` | ~2,2 MB (inclui `docs/brand/LOGO.png` ~1,9 MB) |

### 1.2 Arquivos rastreados na raiz

` .env.example  .gitignore  AGENTS.md  README.md  iniciar.bat  package-lock.json  package.json  playwright.config.ts  tsconfig.base.json  vitest.config.ts  vitest.setup.ts `

Único script `.bat` rastreado: **`iniciar.bat`**.

### 1.3 Arquivos não rastreados (11)

`abrir.bat  e2e-final.cmd  e2e-full.cmd  fechar.bat  restart-admin.cmd  restart-api.cmd  rodar-e2e.cmd  sincronizar-relogio.bat  subir-admin-e2e.cmd  subir-api-e2e.cmd  test-api.cmd`

### 1.4 Pastas ignoradas (presentes no disco, fora do Git)

`apps/admin/.next/  apps/api/data/  apps/api/data-test/  apps/api/node_modules/  apps/store/.next/  data-e2e/  logs/  mirror/  node_modules/  packages/shared/node_modules/  temp_base/  test-results/  vitest/data-test-root/`

### 1.5 Modificados recentemente (não relacionados a esta auditoria)

- `apps/admin/next.config.ts` — mudança pré-existente no worktree (`allowedDevOrigins`).
- `apps/admin/next-env.d.ts` — reescrito automaticamente pelo `next dev` (paths `.next/dev/...`).
- Restante do código-fonte está igual ao HEAD (`git status` só listava os dois acima antes da auditoria).

### 1.6 Scripts referenciados em `package.json` (raiz)

| Script | Comando |
|---|---|
| `dev` / `dev:api` | `npm run dev --workspace @airsoft/api` |
| `dev:store` / `dev:admin` | workspaces store/admin |
| `build` / `test` / `typecheck` | `--workspaces --if-present` |
| `verify` | `tsc --noEmit` em shared/api/store/admin + testes shared + testes api + `npx vitest run --config vitest/config.mts` + `node scripts/check-test-locks.mjs` |
| `db:generate` / `db:migrate` / `db:seed` | workspace api |
| `admin:reset-mfa` | workspace api |
| `test:e2e` | `playwright test --config playwright.config.ts` |

Workspace `@airsoft/api` expõe ainda: `e2e:seed` (`tsx src/cli/e2e-seed.ts`), `db:reset`, `admin:reset-mfa`.

### 1.7 Scripts referenciados em README / AGENTS / .opencode / workflows

| Referência | Onde | Alvo existe? |
|---|---|---|
| `npm install`, `db:seed`, `dev:api`, `dev:store`, `dev:admin`, `npm test`, `typecheck` | README.md | sim (package.json) |
| `iniciar.bat`, `mirror/`, `docs/legacy-zero-dep/`, `scripts/patches/`, `.opencode/skills/*` | README.md / AGENTS.md | sim |
| `node scripts/e2e-seed.mjs` | comentário em `playwright.config.ts` | **NÃO** — o seed real é `apps/api/src/cli/e2e-seed.ts` (`npm run e2e:seed -w @airsoft/api`). Comando obsoleto no comentário. |
| Qualquer `.bat`/`.cmd` da raiz | README/AGENTS/workflows | nenhum referenciado (exceto `iniciar.bat` no AGENTS) |
| Workflows CI | — | não existem |

### 1.8 Comandos de teste

- Unit/integração: `npm test` → suites por workspace + `vitest/config.mts` (testes de domínio em `packages/**` e `vitest/**`).
- Verificação única: `npm run verify` (typecheck + testes + checagem de locks PGlite).
- E2E: Playwright (`playwright.config.ts`, `testDir: ./e2e`), exige API :4000 e Admin :3001 com seed E2E (`e2e:seed` gera e imprime os env `E2E_*` de teste).
- Checagem de locks: `scripts/check-test-locks.mjs` (parte do `verify`); lock do banco de dev (`apps/api/data/.pglite.lock`) é reportado mas não falha.

### 1.9 Referências cruzadas aos potencialmente removíveis

| Alvo | Referências encontradas |
|---|---|
| `abrir.bat`, `fechar.bat`, `restart-*.cmd`, `rodar-e2e.cmd`, `sincronizar-relogio.bat`, `subir-*-e2e.cmd`, `test-api.cmd`, `e2e-*.cmd` | **nenhuma** em código, configs, README, AGENTS ou workflows |
| `iniciar.bat` | `AGENTS.md` (único script da raiz permitido pela regra de estrutura) |
| `apps/api/probe.mjs` | nenhuma (sonda one-off de índices/duplicados de `related_products`) |
| `apps/api/boot.out`, `apps/api/boot.err` | nenhuma (dump de uma execução com `EADDRINUSE :4000`) |
| `temp_base/` | apenas `.gitignore` |
| `mirror/` | `.gitignore`, `AGENTS.md`, `README.md`, `docs/PERFORMANCE-BASELINE-2026-11-07.md`, exclusões em `vitest.config.ts` e `vitest/config.mts` |
| `scripts/check-test-locks.mjs` | `package.json` → `verify` |
| `scripts/patches/fix_hero.py`, `fix_page.py` | nenhuma em código; documentados no README como “histórico” |

---

## 2. CLASSIFICAÇÃO DOS DIRETÓRIOS VISÍVEIS

| Dir | Finalidade | Dev | Teste | Prod | Versionar | .gitignore | Remover? | Risco | Ação |
|---|---|---|---|---|---|---|---|---|---|
| `.opencode/` | Skills do agente (2 `SKILL.md`) | sim | não | não | sim | não | não | alto — regras do projeto | **manter** |
| `apps/` | Código-fonte (api/store/admin) | sim | sim | sim | sim | não (`node_modules`, `.next`, `data*` sim) | nunca | crítico | **manter** |
| `data-e2e/` | Banco PGlite isolado do E2E | sim | sim | não | não | já está | só se nenhum script depender — **dependem** (`e2e-full.cmd`, `subir-*.cmd`, `restart-api.cmd`, `test-api.cmd`) | médio — E2E precisa reseedar | **manter**, já ignorado |
| `docs/` | Contratos, auditorias, históricos, logo, protótipo legado | sim | não | não | sim | não | não (só com consolidação explícita) | alto | **manter** |
| `e2e/` | Specs + helpers Playwright | não | sim | não | sim | não | nunca | crítico | **manter** |
| `logs/` | Logs locais de dev (`api.log`, `store.log`…) | opcional | não | não | não | já está | sim (descartáveis, regeneráveis) | baixo | **limpar conteúdo** |
| `mirror/` | Espelho estático do site antigo (GMTático/TiendaNube) — referência de auditoria | referência | não | não | não | já está | ver §5 | médio | **manter** (sem dado de concorrente; ver §5) |
| `node_modules/` | Dependências | sim | sim | build | não | já está | sim (recriável por `npm install`) | baixo | **manter no disco** (não versionado; remoção só economiza disco, exige reinstall) |
| `packages/` | Domínio compartilhado | sim | sim | sim | sim | não | nunca | crítico | **manter** |
| `scripts/` | Automações oficiais (`check-test-locks.mjs`, `patches/` históricos) | sim | sim (`verify`) | não | sim | não | não | médio | **manter** |
| `temp_base/` | Base de download do espelho + extrações de zip de skill/protótipo (cache local) | não | não | não | não | já está | candidato — conteúdo duplica `mirror/` e `docs/legacy-zero-dep/` | médio (untracked = sem histórico) | **pedir confirmação** (ver §8) |
| `test-results/` | Artefatos do Playwright (última execução 07/11) | não | regenera | não | não | já está | sim | baixo | **limpar conteúdo** |
| `vitest/` | Config/fixtures **reais** (`config.mts`, `setup.mts`, 7 testes de domínio) + `data-test-root/` (PGlite gerado) | não | **sim** | não | sim (exceto `data-test-root/`) | `vitest/data-test-root/` já está | só o `data-test-root/` | baixo | **manter `vitest/`, limpar `data-test-root/`** |

Regra de ouro aplicada: nada é removido sem referência conferida (`git grep` + leitura dos scripts).

---

## 3. AUDITORIA DE SCRIPTS `.BAT`/`.CMD` DA RAIZ

| Arquivo | Rastreado | O que executa | Ainda funciona? | Duplicado de | Depende dele | Remover? | Substituição |
|---|---|---|---|---|---|---|---|
| `iniciar.bat` | **sim** | Checa Node/deps, sobe API+loja+admin, abre navegador | sim | — | `AGENTS.md` (script oficial da raiz) | **não** | é o oficial |
| `abrir.bat` | não | Mesmo de `iniciar.bat` + mata portas ocupadas antes de subir | sim | **`iniciar.bat` (~90% igual)** | ninguém | consolidar | comportamento útil (mata portas parciais) pode ser absorvido por `iniciar.bat` |
| `fechar.bat` | não | Mata PID das portas 4000/3000/3001 | sim | único | ninguém | **não** | par oficial de `iniciar.bat` |
| `iniciar.bat` × `abrir.bat` | — | duplicação clássica | — | — | — | consolidar em 1 | ver §8 |
| `e2e-full.cmd` | não | Mata processos, apaga `data-e2e`, roda `e2e-seed`, extrai env `E2E_*` do log, sobe API+admin, roda Playwright, mata tudo | sim | — | ninguém | **manter** (é o pipeline E2E completo) | — |
| `e2e-final.cmd` | não | Cópia quase idêntica de `e2e-full.cmd` (mesmos 8 passos) | sim | **`e2e-full.cmd`** | ninguém | consolidar | remover ou virar wrapper de `e2e-full.cmd` |
| `rodar-e2e.cmd` | não | Só roda Playwright com env `E2E_*` **hardcoded** | só contra o banco `data-e2e` atual — os secrets de TOTP são gerados por execução do seed (`e2e-seed.ts`); ao reseedar, os valores hardcoded ficam velhos | lógica de env duplicada nos outros `e2e-*.cmd` | ninguém | substituir | forma robusta: `e2e-full.cmd` (extrai env do seed a cada execução) |
| `subir-api-e2e.cmd` | não | Mata processos, sobe API com `PGLITE_DIR=data-e2e`, espera `/healthz` (90s) | sim | par de `restart-api.cmd` | ninguém | manter (ou mover p/ `scripts/windows/`) | — |
| `subir-admin-e2e.cmd` | não | Idem p/ admin, espera `/login` 200 | sim | par de `restart-admin.cmd` | ninguém | manter (ou mover) | — |
| `restart-api.cmd` | não | Fire-and-forget da API (log em `C:\temp`) sem espera de health | sim, mas não valida prontidão | **`subir-api-e2e.cmd`** | ninguém | consolidar | — |
| `restart-admin.cmd` | não | Fire-and-forget do admin (log em `C:\temp`) | sim, sem validação | **`subir-admin-e2e.cmd`** | ninguém | consolidar | — |
| `test-api.cmd` | não | Harness de debug: sobe API, espera 15s, imprime PID/porta/log | sim, mas é debug puro | — | ninguém | remover (obsoleto) | `subir-api-e2e.cmd` |
| `sincronizar-relogio.bat` | não | Sincroniza relógio do Windows (NTP) — necessário p/ TOTP | sim (exige admin) | único | ninguém | **não** | utilitário legítimo |

Duplicações confirmadas:

1. **`iniciar.bat` × `abrir.bat`** — mesma função (subir sistema), `abrir.bat` só acrescenta mata-porta.
2. **`e2e-full.cmd` × `e2e-final.cmd`** — mesma função, passo a passo.
3. **`subir-api-e2e.cmd` × `restart-api.cmd`** (e o par `test-api.cmd` como terceira variação de debug).
4. **`subir-admin-e2e.cmd` × `restart-admin.cmd`**.
5. Env `E2E_*` hardcoded em `rodar-e2e.cmd` duplica o que `e2e-full.cmd` extrai dinamicamente do seed.

Observação: todos escrevem logs fora do repositório (`C:\temp\`) — nenhum artefato sujo fica no Git.

Regra do projeto (`AGENTS.md`): “Nada de arquivo solto na raiz além de configs, `README.md`, `AGENTS.md` e `iniciar.bat`” — os 11 scripts não rastreados violam essa regra; a consolidação abaixo alinha a prática ao documento.

---

## 4. ARTEFATOS TEMPORÁRIOS E GERADOS

| Item | Versionado? | Descartável? | Evidência histórica? | Ação |
|---|---|---|---|---|
| `logs/*.log` (5 arquivos, ~246 KB) | não (`.gitignore`) | sim | não (logs de execução) | limpar conteúdo |
| `test-results/` (artefatos Playwright 07/11) | não | sim — Playwright recria a cada execução | não (relatório da última run; o histórico permanece no relatório deste documento) | limpar conteúdo |
| `vitest/data-test-root/` (~42 MB, PGlite) | não | sim — testes recriam | não | limpar conteúdo |
| `data-e2e/` (~42 MB, PGlite E2E) | não | **não** — scripts dependem | não | manter |
| `apps/api/data/` (banco de dev) | não | **não** — é o banco de desenvolvimento com seed | não | manter |
| `apps/api/data-test/` | não | sim — suíte da API recria | não | limpar se presente |
| `apps/api/boot.out`, `boot.err` | **sim** (rastreados) | sim — dump de erro `EADDRINUSE` | não | remover do Git e do disco (histórico no Git) |
| `apps/api/probe.mjs` | **sim** (rastreados) | sonda one-off sem referências | não | remover do Git e do disco (histórico no Git) |
| `.pglite.lock` em `apps/api/data/` | não | lock de processo dev ativo — **não é vazamento** | — | manter (o `check-test-locks.mjs` só falha p/ dirs de teste) |
| `.next/`, `dist/` | não | sim, regenerados | — | manter (acelera dev local) |
| `C:\temp\*.log` (escritos pelos `.cmd`) | fora do repositório | sim | — | fora do escopo do Git; anotado |

`.gitignore` atual já cobre: `node_modules`, `dist`, `.next`, `*.log`, `.env*`, `data/`, `*.db`, `coverage/`, `mirror/`, `temp_base/`, `logs/`, `*.pglite.lock`, `data-test*`, `apps/api/data*`, `vitest/data-test-root/`, `playwright-report/`, `test-results/`, `blob-report/`, `playwright/.cache/`.
Lacuna detectada: **`data-e2e/`** não aparece como linha explícita legível no `.gitignore` (o Git a ignora hoje via padrão na linha 13; a edição abaixo a torna explícita e verificável).

---

## 5. DIRETÓRIO `mirror/` E DADOS PROIBIDOS

- **Referenciado por:** `.gitignore` (ignorado), `AGENTS.md` (regra “nunca copiar de terceiros”), `README.md` (descrito como referência de auditoria), `docs/PERFORMANCE-BASELINE-2026-11-07.md` (menção), exclusões de teste em `vitest.config.ts` e `vitest/config.mts`.
- **Conteúdo:** captura estática (SaveWeb2Zip) do site anterior **GMTático/TiendaNube** — o próprio site que deu origem ao levantamento da skill (`gmtatico.com.br/`, assets de CDN da plataforma TiendaNube, templates do tema, jQuery/CDN públicos, `127.0.0.1_8081` = captura local).
- **Rastreado pelo Git:** não (`.gitignore` linha `mirror/`).
- **Necessário:** sim, como evidência de auditoria funcional (fonte de `FEATURES_INVENTORY`, taxonomia e referência visual). Não é código do novo sistema.
- **Dados de concorrente:** **não identificados** — os domínios presentes são o site predecessor do próprio cliente, CDNs de plataforma (mitiendanube/cloudfront), CDN público (googleapis) e captura local. Nenhum domínio de loja concorrente. Nada foi copiado para seed/loja (verificado: seeds usam taxonomia própria em `apps/api/src/db/`).
- **Ação:** manter no disco, mantido fora do Git. Não remover (perda de evidência de auditoria sem benefício de espaço: 7,6 MB).

---

## 6. DOCUMENTAÇÃO E CONFIGURAÇÕES DUPLICADAS

| Item | Situação | Ação |
|---|---|---|
| `docs/PERFORMANCE-*` (3 arquivos) | relatórios distintos (baseline, delta fase3, otimização N1) | manter — históricos diferentes |
| `docs/AUDITORIA-FASE-A.md` × `AUDITORIA-FASE1-GMTATICO.md` | escopos distintos | manter |
| `docs/legacy-zero-dep/*.bak` + zip | cópias de segurança de skills/protótipo, **documentadas no README** | manter |
| `docs/legacy-zero-dep/public-app.css/js` × `loja/public/*` | duplicatas internas do protótipo legado | manter (material morto documentado; consolidar só se o legado for removido — não é o caso) |
| Comando obsoleto `node scripts/e2e-seed.mjs` no comentário de `playwright.config.ts` | descreve comando inexistente | **corrigir comentário** → `npm run e2e:seed -w @airsoft/api` |
| README sem menção a `npm run verify` / pipeline E2E | incompleto, não conflitante | **atualizar README** com comandos oficiais |
| `AGENTS.md` permite só `iniciar.bat` na raiz, mas há 11 scripts soltos | conflito prática × documento | resolver na consolidação (§8) |
| Arquivos de ambiente | só `.env.example` versionado; `.env` ignorado | sem duplicatas |
| Seeds | `apps/api/src/db/seed.ts` (dev) e `apps/api/src/cli/e2e-seed.ts` (E2E) — papéis distintos | manter ambos |

---

## 7. ORGANIZAÇÃO RECOMENDADA

Estado-alvo (aplicado na execução §8):

```text
raiz/           → configs + README.md + AGENTS.md + iniciar.bat + fechar.bat
apps/           → api, store, admin (inalterado)
packages/       → shared (inalterado)
e2e/            → specs + helpers (inalterado)
scripts/        → check-test-locks.mjs, patches/ (histórico), windows/ (wrappers Windows restantes)
docs/           → relatórios + este documento
.opencode/      → skills (inalterado)
vitest/         → config/fixtures reais (data-test-root/ limpo, ignorado)
logs/           → limpo, ignorado
test-results/   → limpo, ignorado
data-e2e/       → mantido (dependência do E2E), ignorado
temp_base/      → ver §8 (confirmação)
mirror/         → mantido (referência de auditoria), ignorado
node_modules/   → mantido no disco, ignorado
```

Nenhuma pasta nova é criada por estética — apenas `scripts/windows/` se a movimentação dos wrappers for confirmada.

---

## 8. EXECUÇÃO SEGURA DA LIMPEZA

**Confirmações interativas registradas (Kai):** (1) "Consolidar completo" para os 11 scripts `.bat`/`.cmd` da raiz; (2) "Remover temp_base".

**Nada foi apagado sem registro.** Arquivos rastreados saíram com `git rm` (staged, recuperáveis do histórico); conteúdo não rastreado removido era regenerável ou aprovado explicitamente. Nenhum commit foi feito, nada foi enviado a remoto.

### 8.1 Removidos com segurança

| Item | Método | Recuperação |
|---|---|---|
| `apps/api/boot.out`, `apps/api/boot.err`, `apps/api/probe.mjs` | `git rm` (staged `D`) | `git show HEAD:<caminho>` |
| Conteúdo de `logs/`, `test-results/`, `vitest/data-test-root/`, `apps/api/data-test/` | artefatos regeneráveis, já em `.gitignore` | recriados nas próximas execuções |
| `temp_base/` (cache local: base de download do espelho + extrações de zip — aprovado por Kai) | diretório não rastreado, já em `.gitignore` | não tinha uso em código/teste/build (auditado em §11.6) |
| `abrir.bat`, `e2e-final.cmd`, `restart-api.cmd`, `restart-admin.cmd`, `test-api.cmd` | duplicatas/obsoletos (§3) | conteúdo consolidado nos sobreviventes; histórico git |
| `raiz)` (arquivo de 0 bytes, artefato de typo de comando,09/11 07:19) | varredura final da raiz | lixo, sem conteúdo |

### 8.2 Movido ou consolidado

- 6 sobreviventes → `scripts/windows/`: `fechar.bat`, `rodar-e2e.cmd`, `subir-api-e2e.cmd`, `subir-admin-e2e.cmd`, `sincronizar-relogio.bat`, `e2e-full.cmd` — com correção de caminho (`cd /d "%~dp0\..\.."`) e normalização ASCII + CRLF.
- Raiz ficou apenas com configs + `README.md` + `AGENTS.md` + `iniciar.bat`.
- `README.md`: estrutura (e2e/, scripts/), atalhos Windows, `npm run verify` e pipeline E2E atualizados.
- `playwright.config.ts`: somente comentário obsoleto corrigido (`node scripts/e2e-seed.mjs` → `npm run e2e:seed --workspace @airsoft/api`).
- `.gitignore`: + `data-e2e/` (regra explícita; reescrito por completo em 2026-11-09 — ver §11.7). Antes **não** era ignorado: não há regra `data-*` e `data/` não cobre `data-e2e`.

### 8.3 Bugs encontrados nos wrappers e corrigidos (não contornados)

1. `npx`/`npm` sem `call` em `.cmd` — o controle nunca voltava ao wrapper; passos seguintes não executavam.
2. Bloco `powershell -Command "` multilinha — cmd é linha a linha; o export dos envs do seed nunca rodou. Substituído por `scripts/windows/export-e2e-env.ps1` (emite `set "K=V"`) consumido via `for /f` + guarda `if not defined E2E_TOTP_SECRET`.
3. `NODE_ENV=development` na API do E2E — o bypass de rate limit de `apps/api/src/middleware/authRateLimit.ts` exige `NODE_ENV === "test"` + `E2E_READY === "1"`; sem isso o login do admin estoura o balde (10/min, bloqueio de 15 min) a partir do teste 15 → 429. Agora sobe com `NODE_ENV=test`.
4. `chcp 65001` + acentos UTF-8 faziam o cmd comer os primeiros caracteres de comandos — wrappers normalizados para ASCII puro + CRLF (`normalize-wrappers.ps1`).
5. Escape `\$` do PowerShell removido (rejeitado pelo parser).

### 8.4 Integridade funcional

Zero alteração em regras de negócio, auth, MFA, RBAC, CSRF, auditoria, catálogo, estoque, pagamentos ou qualquer comportamento. Nenhum teste alterado (apenas comentário do `playwright.config.ts`). Diffs preexistentes do worktree em `apps/admin/next.config.ts` e `apps/admin/next-env.d.ts` **não** foram tocados nem revertidos.

## 9. VALIDAÇÃO OBRIGATÓRIA

### 9.1 `npm run verify` → exit 0

```text
VERIFY_EXIT_CODE=True        # PowerShell: $? = True ⇒ exit 0
```

typecheck dos 4 workspaces (shared, api, store, admin) · shared 6 testes · api 129 testes (23 arquivos) · root vitest 19 testes (6 arquivos, type errors: none) · `check-test-locks`: `ok: nenhum lock PGlite em diretórios de teste`.

### 9.2 Pipeline E2E → `E2E_EXIT_CODE=0`

Executado por `scripts\windows\e2e-full.cmd` — banco novo (`data-e2e` limpo) + seed + API com `NODE_ENV=test` + admin + o comando `npx playwright test --reporter=list` com `E2E_READY=1` (mesma linha de comando e mesmas condições do comando literal):

```text
  22 passed (56.1s)
============================================================
  E2E_EXIT_CODE=0
============================================================
[LIMPEZA] Encerrando servidores...
E2E_SUCESSO
```

- 22/22 testes, ~89 s no total; log completo em `C:\temp\e2efull-run3.log`.
- `node scripts/check-test-locks.mjs` → exit 0 (lock dev `apps/api/data/.pglite.lock` com `holder_vivo=false`, ignorado por design — não é vazamento de teste).
- Portas 4000/3001 mortas após a execução; nenhum lock E2E vazou; nenhum segredo adicionado.

### 9.3 `git status --short` (final)

```text
 M .gitignore
 M README.md
 M apps/admin/next-env.d.ts
 M apps/admin/next.config.ts
D  apps/api/boot.err
D  apps/api/boot.out
D  apps/api/probe.mjs
 M playwright.config.ts
?? docs/REPOSITORY-CLEANUP-2026-11-08.md
?? scripts/windows/
```

`D ` = staged via `git rm`; `next-env.d.ts`/`next.config.ts` são preexistentes (§8.4).

### 9.4 `git diff --stat` (final)

```text
 .gitignore                |  1 +
 README.md                 | 20 ++++++++++++++++++++
 apps/admin/next-env.d.ts  |  4 ++--
 apps/admin/next.config.ts |  1 +
 playwright.config.ts      |  3 ++-
 5 files changed, 26 insertions(+), 3 deletions(-)
```

### 9.5 `git diff -- .gitignore package.json README.md docs/REPOSITORY-CLEANUP-2026-11-08.md`

- `.gitignore`: +1 linha (`data-e2e/`).
- `README.md`: +20 linhas (estrutura, atalhos Windows, verify, E2E).
- `package.json`: **sem alteração**.
- `docs/REPOSITORY-CLEANUP-2026-11-08.md`: é novo (untracked) — não aparece em `git diff`, aparece em `git ls-files --others`.

### 9.6 `git ls-files --others --exclude-standard`

```text
docs/REPOSITORY-CLEANUP-2026-11-08.md
scripts/windows/e2e-full.cmd
scripts/windows/export-e2e-env.ps1
scripts/windows/fechar.bat
scripts/windows/rodar-e2e.cmd
scripts/windows/sincronizar-relogio.bat
scripts/windows/subir-admin-e2e.cmd
scripts/windows/subir-api-e2e.cmd
```

Somente o relatório e os wrappers movidos. Nada commitado, nada empurrado a remoto.

## 10. RELATÓRIO FINAL

1. **INVENTÁRIO** — 549 arquivos rastreados + 11 não rastreados no início; 11 scripts `.bat`/`.cmd` na raiz; classificação de diretórios, artefatos, docs e espelho nas §§1–7.
2. **REMOVIDO COM SEGURANÇA** — `boot.out`/`boot.err`/`probe.mjs` (git rm, recuperáveis do histórico); conteúdo de `logs/`, `test-results/`, `vitest/data-test-root/`, `apps/api/data-test/` (regenerável e já ignorado); `temp_base/` (aprovado por Kai); 5 scripts duplicados/obsoletos; arquivo lixo `raiz)`. Detalhe na §8.1.
3. **MOVIDO OU CONSOLIDADO** — 6 wrappers → `scripts/windows/` com caminhos corrigidos e ASCII+CRLF; raiz só com `iniciar.bat`; README e comentário do `playwright.config.ts` atualizados (§8.2).
4. **ADICIONADO AO `.GITIGNORE`** — `data-e2e/` (linha 31; antes visível para o git).
5. **MANTIDO E MOTIVO** — `data-e2e/` e `apps/api/data/` (dependência de E2E/dev); `docs/` (contratos); patches históricos em `scripts/` (oficiais); `iniciar.bat` (atalho raiz por convenção); `.env.example` (não existe `.env` versionado). `mirror/` saiu desta lista: **removido do disco na revisão de 2026-11-09 (§11.5)**.
6. **NÃO REMOVIDO POR RISCO** — `apps/admin/next.config.ts` e `next-env.d.ts` (diffs preexistentes do worktree, funcionais — intocados); `package-lock.json` (reprodutibilidade); specs `e2e/` e suítes de teste; qualquer arquivo sem referência comprovada (regra: inventário primeiro, remoção só com prova).
7. **SCRIPTS DUPLICADOS** — 11 → 7: removidos `abrir.bat`, `e2e-final.cmd`, `restart-api.cmd`, `restart-admin.cmd`, `test-api.cmd`; mantidos/movidos `fechar`, `rodar-e2e`, `subir-api-e2e`, `subir-admin-e2e`, `sincronizar-relogio`, `e2e-full` + novo helper `export-e2e-env.ps1`; bugs de wrapper corrigidos (§8.3) e kill global substituido por kill por porta (§11.7); validação: suíte completa 22/22.
8. **DADOS OU ARTEFATOS DE CONCORRENTE** — nenhum. O espelho do site predecessor (gmtatico/TiendaNube) era só captura estática de HTML/assets, usada como referência de auditoria — **removido do disco em 2026-11-09 (§11.5)**, com inventário registrado; nada de concorrente em código, docs ou logs; nenhum segredo em relatórios ou logs.
9. **VALIDAÇÃO** — `verify` exit 0 (§9.1); E2E 22/22, exit 0 (§9.2); lock check exit 0; `git status`/`diff`/`untracked` nas §9.3–9.6.
10. **PENDÊNCIAS** —
    - Alterações **não commitadas** (nada pushado): staged `D` (3 arquivos), modificados `.gitignore`/`README.md`/`playwright.config.ts`, untracked `docs/REPOSITORY-CLEANUP-2026-11-08.md` e `scripts/windows/` — aguardam revisão e commit de Kai.
    - Diffs preexistentes `apps/admin/next.config.ts` (`allowedDevOrigins`) e `apps/admin/next-env.d.ts` (gerado pelo Next) deixados como estavam — decidir se entram no commit ou são revertidos.
    - ~~`e2e-full.cmd` encerra serviços com `taskkill /F /IM node.exe`~~ — **CORRIGIDO em 2026-11-09**: kill por porta via `netstat`/`taskkill /PID` nos três wrappers, com prova em §11.7–11.8.
    - `rodar-e2e.cmd` usa os envs do seed atual de `data-e2e`; após reseed, reexportar (o `e2e-full.cmd` faz isso automaticamente).
    - Lock dev `apps/api/data/.pglite.lock` está com holder morto (harmless — o check passa); apagar manualmente se o dev reclamar.
    - Wrappers dependem de `C:\temp` gravável (`seed.log`, `e2e-ports.json`) — padrão do Windows, mas vale saber.
    - `.gitignore` linha 18 tem comentário com encoding quebrado (`n�o`) — preexistente, cosmético.
    - Não existem workflows `.github`; `npm run verify` segue como gate oficial de fechamento.

---

## 11. REVISÃO FINAL PRÉ-COMMIT — 2026-11-09

Pedido de Kai: separar preexistentes, corrigir o kill global, decidir `temp_base` e `mirror`, rever estrutura/.gitignore, validarrer e reportar. **Nenhum commit foi feito.** Esta seção atualiza, para fins de commit, as informações das §§8–10.

### 11.1 ALTERAÇÕES DA LIMPEZA (pertencem ao commit de limpeza)

- **Staged (`git rm`):** `apps/api/boot.out`, `apps/api/boot.err`, `apps/api/probe.mjs`.
- **Modificados (unstaged):** `.gitignore` (reescrito, ASCII, comentários por seção, regra `data-e2e/` explícita), `README.md` (estrutura, atalhos, verify, E2E, `mirror/` removido), `playwright.config.ts` (só comentário), `e2e/auth-admin.spec.ts` (só comentário), `AGENTS.md` (só a regra do espelho, atualizada).
- **Novos (untracked):** `docs/REPOSITORY-CLEANUP-2026-11-08.md`, `scripts/windows/` (6 wrappers + `export-e2e-env.ps1`).
- **Remoções não rastreadas registradas:** conteúdo de `logs/`, `test-results/`, `vitest/data-test-root/`, `apps/api/data-test/`, `temp_base/`, `mirror/`, arquivo lixo `raiz)`.

### 11.2 ALTERAÇÕES PREEXISTENTES SEPARADAS

`git diff -- apps/admin/next.config.ts apps/admin/next-env.d.ts` mostrou:

- **`next.config.ts`** — `+ allowedDevOrigins: ["127.0.0.1", "localhost"]`. Funcional (Next 16), anterior à limpeza. **Mantido no worktree e fora do commit de limpeza** — não é consequência da organização.
- **`next-env.d.ts`** — troca de `./.next/types/...` por `./.next/dev/types/...`. O próprio arquivo diz "should not be edited": é regenerado pelo `next dev`. **Restaurado ao HEAD** com `git checkout -- apps/admin/next-env.d.ts`; em seguida `npx tsc --noEmit -p apps/admin/tsconfig.json` = **0** com o arquivo restaurado. Saiu do `git status`. Observação: qualquer `next dev` volta a regenerá-lo — comportamento de arquivo gerado rastreado (pendência §11.9).

### 11.3 ARQUIVOS REMOVIDOS

| Arquivo/pasta | Status git | Registro |
|---|---|---|
| `apps/api/boot.out`, `boot.err`, `probe.mjs` | staged `D`, recuperáveis do histórico | §8.1 |
| conteúdo de `logs/`, `test-results/`, `vitest/data-test-root/`, `apps/api/data-test/` | untracked, regenerável | §8.1 |
| `temp_base/` (7,6 MB, cache) | untracked, já ignorado | §11.6 |
| `mirror/` (207 arquivos, 7,2 MB) | untracked, já ignorado | §11.5 |
| `abrir.bat`, `e2e-final.cmd`, `restart-api.cmd`, `restart-admin.cmd`, `test-api.cmd` | tracked (histórico) | §8.1 |
| `raiz)` (0 bytes, typo de comando) | untracked | §8.1 |

### 11.4 ARQUIVOS MOVIDOS

6 wrappers → `scripts/windows/` (`fechar.bat`, `rodar-e2e.cmd`, `subir-api-e2e.cmd`, `subir-admin-e2e.cmd`, `sincronizar-relogio.bat`, `e2e-full.cmd`), caminhos corrigidos (`cd /d "%~dp0\..\.."`), ASCII + CRLF (normalizador re-executado após as edições de 2026-11-09: 7 arquivos, `bytes>127=0`). Raiz só com configs + `README.md` + `AGENTS.md` + `iniciar.bat`.

### 11.5 MIRROR

- **Verificação técnica:** 207 arquivos / 7,2 MB — 184 `.webp`, 14 `.png`, 4 `.css`, 3 `.js`, 1 `.ico`, 1 `.html` (captura SaveWeb2Zip do site antigo).
- **Referências fora do próprio espelho:** `AGENTS.md` e `README.md` (prosa), exclusões inertes `mirror/**` em `vitest.config.ts` e `vitest/config.mts`. **Zero dependência funcional:** nenhum código, teste, seed, build ou bundle lê `mirror/` (grep em ts/tsx/js/mjs/json/md/bat/cmd/yaml/mts).
- **Decisão:** removido do disco (irreversível — não estava no git; inventário registrado nesta seção). Nada foi copiado para seed, produto, loja ou API.
- **Documentação textual preservada:** `docs/FEATURES_INVENTORY.md` (capacidades observadas, módulo a módulo) e `docs/AUDITORIA-FASE1-GMTATICO.md`. `README.md` e `AGENTS.md` atualizados para apontar esses docs. Nenhum catálogo, imagem, preço ou texto externo reproduzido.
- **Regras mantidas:** `mirror/` continua no `.gitignore` e nas exclusões do vitest — se alguém baixar a captura de novo, ela não entra no git nem nos testes.

### 11.6 TEMP_BASE

Auditoria de referências após a remoção: `temp_base` aparece **apenas** no `.gitignore` (regra) e neste relatório. Zero ocorrências em código, scripts, `package.json`, `README`, `AGENTS`, configs, testes e `.opencode`. Diretório já tinha sido removido do disco na execução da limpeza, com confirmação interativa de Kai registrada (§8). Regra mantida no `.gitignore`.

### 11.7 RISCOS CORRIGIDOS

1. **`taskkill /F /IM node.exe` eliminado** — eram 8 ocorrências em 3 wrappers (`e2e-full.cmd` pré+pós, `subir-api-e2e.cmd`, `subir-admin-e2e.cmd`). Substituído por sub-rotina `:kill_port`: `netstat -ano -p TCP` → `findstr` em `LISTENING`/`OUVINDO` → `taskkill /F /PID`, com dedup de PID — o mesmo padrão já provado no `fechar.bat`. Alvo por script: `e2e-full` mata só 4000/3001 (as portas que ele sobe), `subir-api` só 4000, `subir-admin` só 3001; `fechar.bat` segue cobrindo 4000/3000/3001. Node de outros projetos não é alcançado.
2. **Cleanup nos caminhos de falha** do `e2e-full`: `:erro_api` e `:erro_admin` agora chamam `:kill_port` antes de sair — antes, falha no admin deixava a API órfã na4000.
3. **Numeração de passos** do `e2e-full` normalizada para `[1/8]..[8/8]` (misturava `/7` e `/8`).
4. **`.gitignore` reescrito** em ASCII com comentários por seção — corrige o comentário com encoding quebrado (`não`) e mantém todas as regras anteriores + `data-e2e/` explícito.
5. **Referência obsoleta** `scripts/e2e-seed.mjs` removida do comentário de `e2e/auth-admin.spec.ts` → `npm run e2e:seed -w @airsoft/api` (o de `playwright.config.ts` já havia sido corrigido).

### 11.8 VALIDAÇÃO (2026-11-09, após as correções)

- **`npm run verify; echo "VERIFY_EXIT_CODE=$?"` → exit 0** (PowerShell `$?` = `True`): typecheck dos 4 workspaces · shared 6 · api 129 (23 arquivos) · root 19 (type errors: none) · `check-test-locks`: `ok: nenhum lock PGlite em diretórios de teste`.
- **`scripts\windows\e2e-full.cmd` → 22 passed (57.1s), 0 failed, 0 skipped:**

```text
  22 passed (57.1s)
============================================================
  E2E_EXIT_CODE=0
============================================================
[LIMPEZA] Encerrando servidores (somente portas 4000/3001)...
E2E_SUCESSO
E2E_FULL_SHELL_EXIT=0
```

- **Prova do kill seletivo:** dois processos node fictícios iniciados antes do run — A ouvindo na 5555 (PID 33848) e B ocioso (PID 36764) — **ambos vivos após o run**; 4000 e 3001 livres; 5555 ainda ocupada por A. Com o `taskkill /IM` antigo, os dois teriam morrido. Fictícios encerrados em seguida. Log: `C:\temp\e2efull-run4.log`.
- **`npx tsc --noEmit -p apps/admin/tsconfig.json` = 0** após restaurar `next-env.d.ts`.
- **`git check-ignore -v`:** `mirror/`→linha 35, `data-e2e/`→19, `temp_base/`→36, `logs/`→9, `test-results/`→29, `.env`→12; `.env.example`, `docs/`, `scripts/`, `README.md` **não** ignorados.
- **`git diff --check`** e **`git diff --cached --check`**: sem erros de whitespace.
- Nenhum lock de teste abandonado; portas 4000/3001/3000 livres ao final; nenhum servidor órfão; nenhum secret novo; nenhum arquivo funcional apagado; nenhum dado externo entrando no produto.

**`git status --short` (final):**

```text
 M .gitignore
 M AGENTS.md
 M README.md
 M apps/admin/next.config.ts
D  apps/api/boot.err
D  apps/api/boot.out
D  apps/api/probe.mjs
 M e2e/auth-admin.spec.ts
 M playwright.config.ts
?? docs/REPOSITORY-CLEANUP-2026-11-08.md
?? scripts/windows/
```

**`git diff --stat` (unstaged):**

```text
 .gitignore                | 37 +++++++++++++++++++++++--------------
 AGENTS.md                 |  2 +-
 README.md                 | 22 +++++++++++++++++++++-
 apps/admin/next.config.ts |  1 +
 e2e/auth-admin.spec.ts    |  2 +-
 playwright.config.ts      |  3 ++-
 6 files changed, 49 insertions(+), 18 deletions(-)
```

**`git diff --cached --stat` (staged):**

```text
 apps/api/boot.err  | 11 -----------
 apps/api/boot.out  |  1 -
 apps/api/probe.mjs |  7 -------
 3 files changed, 19 deletions(-)
```

**`git ls-files --others --exclude-standard`:**

```text
docs/REPOSITORY-CLEANUP-2026-11-08.md
scripts/windows/e2e-full.cmd
scripts/windows/export-e2e-env.ps1
scripts/windows/fechar.bat
scripts/windows/rodar-e2e.cmd
scripts/windows/sincronizar-relogio.bat
scripts/windows/subir-admin-e2e.cmd
scripts/windows/subir-api-e2e.cmd
```

### 11.9 PENDÊNCIAS (antes de qualquer commit)

1. **Nada commitado, nada pushado** — aguardando revisão do diff final por Kai.
2. **`apps/admin/next.config.ts` continua modificado** (pré-existente, funcional) — **não** faz parte do commit de limpeza; decidir se entra em commit separado ou permanece só no worktree.
3. **`next-env.d.ts` volta a ser regenerado** por qualquer `next dev` (arquivo gerado rastreado) — se aparecer modificado de novo, é o Next, não a limpeza.
4. **Caminho de falha do `e2e-full`** (`:erro_api`/`:erro_admin`) está implementado mas não exercitado em runtime — a validação de 2026-11-09 rodou o caminho de sucesso.
5. Wrappers usam `start /B` com logs em `C:\temp\` (fora do repositório, como pedido).
6. Lock dev `apps/api/data/.pglite.lock` com holder morto (harmless — o check passa).
7. Regras `mirror/` (`.gitignore`) e exclusões `mirror/**` (vitest) mantidas de propósito — remover só se Kai quiser.

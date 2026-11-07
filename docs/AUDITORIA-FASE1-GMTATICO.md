# AUDITORIA FASE 1 — Reconstrução AIRSOFT AMERICANA (padrão estrutural GM TÁTICO)

**Data:** 2026-11-05 · **Escopo:** auditoria completa do repositório antes de qualquer alteração (exigência da spec GM TÁTICO, Fase 1) · **Método:** leitura integral de `apps/api`, `apps/store`, `apps/admin`, `packages/shared`, docs, seed e testes.

---

## 1. Stack atual (o que existe)

| Camada | Tecnologia | Arquivos-chave |
|---|---|---|
| API | Fastify 5 + zod + pino, JWT (jose, HS256, 24h) | `apps/api/src/server.ts`, `routes/index.ts` (854 l.), `middleware/auth.ts` |
| Banco | Drizzle ORM + Postgres, **dual-mode**: `DATABASE_URL` → pg Pool; vazio → PGlite embutida (`apps/api/data/airsoft.db`, já materializada) | `apps/api/src/db/index.ts`, `schema.ts` (623 l.), `migrate.ts` (564 l., DDL idempotente à mão) |
| Loja | Next.js 16.4.5 + React 19 + Tailwind 4 (CSS-first), porta 3000 | `apps/store/src/app/**` |
| Admin | Next.js 16, porta 3001 | `apps/admin/src/app/**` |
| Compartilhado | `@airsoft/shared`: domínio (13 status, máquina de transições, tipos de movimento) + schemas zod | `packages/shared/src/{domain,schemas}.ts` |
| Pagamentos | Interface `PaymentAdapter` + 4 adaptadores: `sandbox` (funcional), `mercadopago`, `pagbank`, `cielo` (APIs reais) | `apps/api/src/services/payments/*` |
| Antifraude | Motor de regras configurável (7 regras seed), score 0–100 → 3 faixas (liberar/revisar/bloquear) | `services/fraud.ts` |
| Testes reais | Suite de integração contra PGlite, **inclui teste de 20 compras simultâneas do último item** | `services/checkout.test.ts` (708 l.) |

---

## 2. Veredito geral

**O núcleo transacional é real e se mantém — não recriar:** recálculo de preço/desconto/frete no servidor, reserva transacional de estoque (`SELECT … FOR UPDATE`), antifraude em 3 faixas, checkout transacional (pedido + itens + reserva + histórico em uma transação), cupons server-side, auth cliente/admin, audit log append-only, credenciais de gateway cifradas (AES-256-GCM).

**O que a spec GM TÁTICO pede e NÃO existe hoje é, essencialmente:** (a) toda a superfície de CMS comercial (banners, campanhas, montagem da homepage), (b) o webhook de pagamento, (c) a página de produto completa, (d) a conta do cliente, (e) páginas institucionais, (f) o grosso do painel administrativo além de produtos/clientes.

**Tabelas órfãs:** `banners`, `homepage_sections`, `product_specs`, `related_products`, `support_tickets` existem **só no DDL bruto** (`migrate.ts`), sem schema Drizzle, sem seed, sem rota, sem UI. Ou seja: a estrutura que a nova spec exige **já foi prevista no banco e abandonada no código**. A reconstrução deve religar essas tabelas, não inventar outras.

---

## 3. Ativo descoberto — catálogo real do espelho

`apps/api/src/db/catalog.seed.json` — **gerado em 2026-11-05, nada o consome**:

- **261 produtos reais** do espelho/live GM TÁTICO: nome, SKU, `priceCents`, `promoPriceCents`, estoque, peso, categoria (URL), imagem principal + imagens locais (`/produtos/*.webp`).
- **40 categorias** com hierarquia de URL do espelho (`/airsoft/armas-de-airsoft/rifle-de-airsoft-gbbr/` etc.).
- `brands: 0` (marcas viraram texto no nome do produto).
- ⚠️ `imageUrl` aponta para o CDN da TiendaNube do concorrente (`acdn-us.mitiendanube.com`). Antes de produção: baixar as imagens para storage próprio (a `@fastify/multipart` já está instalada sem rota de upload — fecha as duas lacunas com uma rota).
- ⚠️ Preços do espelho são do concorrente. Importar como **preço base migrado** e deixar o admin reprecificar em lote; a spec proíbe apresentar condições inventadas, e copiar preço de concorrente também não é condição própria — o import marca origem e o admin ajusta.

**Consequência:** o requisito "Não utilizar produtos fictícios" já tem matéria-prima pronta — o import do `catalog.seed.json` vira a primeira tarefa da fase de catálogo.

---

## 4. Mapa spec GM TÁTICO → estado atual → ação

Prioridades da spec em ordem de impacto.

| # | Item da spec | Estado atual (arquivo) | Ação |
|---|---|---|---|
| 1 | **Cabeçalho + mega menu** | ✅ Existe e é real: topbar benefícios + logo + busca + carrinho + `MegaMenu.tsx` alimentado por `/api/store/categories`, acessível (focus/blur), badge 18+ | **Preservar.** Falta: departamentos dinâmicos com imagem/atalho por categoria (colunas `image_url`/`description` já existem só no DDL). Ação: religar essas colunas ao schema e expor no mega menu |
| 2 | **Homepage com vitrines comerciais** | ⚠️ Homepage real (spotlight dinâmico, trustbar, departamentos, Novidades/Destaques, marcas, newsletter) mas `/api/store/home` espelha `featured` em `news`/`sale` e devolve `banners: []` sempre; tabela `homepage_sections` órfã | **Religar:** schema Drizzle + seed + rotas para `banners` e `homepage_sections`; endpoint `/api/store/home` passa a ler seções configuradas (ordem, título, ativo); vitrines "Seleção da loja" e "Mais vendidos" viram seções com `config` (lista manual / agregação de vendas reais) |
| 3 | **Catálogo e categorias** | ⚠️ Funcional: filtros categoria/marca, busca, paginação, badges 18+/esgotado. **Bug:** `price_asc`/`price_desc` aceitos e não ordenados (`services/products.ts` l.43-46 só trata `news`/`featured`) | Corrigir ordenação por preço (join com variante de menor preço); importar as 40 categorias e 261 produtos do `catalog.seed.json`; filtros por faixa de preço e disponibilidade |
| 4 | **Página individual do produto** | ⚠️ Parcial: preço/PIX/estoque/add-to-cart ok. **Sem** galeria real (placeholder de iniciais), sem variações selecionáveis (só 1ª), sem especificações (tabela `product_specs` órfã), sem relacionados (tabela órfã), sem cálculo de frete na PDP | Reconstruir PDP: galeria com zoom (imagens do import), seletor de variação, specs, relacionados, calculadora de CEP inline, aviso 18+ por categoria |
| 5 | **Carrinho e checkout** | ⚠️ Carrinho completo (persistente, qty, cupom). Checkout funcional mas reduzido: 3 passos visuais, **sem escolha de frete** (sempre o mais barato), sem parcelamento, **sem tela de pagamento** (QR PIX/boleto nunca exibidos), sem página de confirmação | Checkout em etapas da spec: endereço → frete (3 opções) → pagamento → revisão → confirmação; renderizar QR PIX/código boleto do adapter; página `/pedido/:number` com status e rastreio |
| 6 | **Login e cadastro** | ✅ Reais (bcrypt, JWT httpOnly + localStorage). `/conta` é stub: "Meus pedidos" é card vazio embora `GET /api/orders` exista | Completar conta: pedidos (UI consumindo API existente), endereços (tabela `customer_addresses` existe **sem nenhuma rota**), rastreio, troca de senha |
| 7 | **Rodapé + institucional** | ❌ Footer linka `/contato` → **404**. Nenhuma página institucional | Criar `/contato`, `/quem-somos`, `/trocas-e-devolucoes`, `/perguntas-frequentes`, `/condicoes-de-frete` (o espelho tem o conteúdo-fonte em `catalog.seed.json` categories) |
| 8 | **Webhook de pagamento** | ❌ **Peça central ausente**: `verifyWebhookSignature`/`parseWebhook` implementados em todos os adapters, tabela `payment_events` com `unique(provider,event_id)` pronta — **nenhuma rota HTTP** | Criar `POST /api/webhooks/:provider`: assinatura → idempotência por event_id → atualização de pagamento/pedido → reconciliação. Sem isso, nenhum pagamento real conclui |
| 9 | **Antifraude / chargeback (admin)** | ⚠️ Motor de score real no checkout; central de chargebacks com serviço completo (lista, evidências, **export PDF 1.4 escrito à mão**) — **zero rotas, zero UI**. `/fraud` do admin é mock estático | Expor rotas admin (assessments, review manual, watchlist, chargebacks + PDF) e construir UI; a regra `address_divergent` está inativa de fato porque nenhuma rota popula `customer_addresses` |
| 10 | **Estoque (admin)** | ✅ Serviço completo (reserve/release/consume/adjust, histórico com ator/motivo) — **UI inexistente** | Construir `/admin/estoque`: saldos, movimentação com motivo, alertas de mínimo |
| 11 | **Pedidos (admin)** | ❌ `/admin/orders` mock estático ("#1001 João Silva") embora `GET /api/admin/orders` + transition existam | Construir UI real: lista, filtro por status, detalhe, transição, rastreio |
| 12 | **Dashboard (admin)** | ❌ 100% hardcoded ("R$ 3.450,00") embora `/api/admin/metrics` calcule tudo do banco | Religar dashboard aos dados reais |
| 13 | **Banners/campanhas** | ❌ Tabela órfã; seed não cria banner | CRUD admin + carrossel na home com os campos da spec (título, subtítulo, imagem desktop/mobile, link, datas, status, ordem) |
| 14 | **Cupons / promoções / marcas / categorias (admin)** | ❌ Páginas admitem no próprio texto "sem endpoint de admin dedicado" | CRUDs + rotas; marca ganha `logo_url` (coluna já no DDL) |
| 15 | **RBAC** | ❌ `requireRole()` existe e **nunca é usado**; qualquer token admin acessa qualquer rota admin | Aplicar papéis (admin/manager/operator/viewer) por rota |
| 16 | **Upload de imagens** | ❌ `@fastify/multipart` instalado, sem rota; imagens só por URL | Rota de upload (tipo/tamanho validados) para produto e banner — resolve também a dependência do CDN externo |
| 17 | **Shipments/rastreio** | ❌ Tabelas `shipments`/`shipping_events` sem código | Rota admin de expedição + página pública de rastreio |
| 18 | **Institucional/newsletter** | ⚠️ Newsletter real (`POST /api/newsletter`, upsert); institucional ausente | Ver linha 7 |

---

## 5. Bugs confirmados (com evidência)

1. **Frete grátis nunca ativa:** `config.ts` l.20 define `FRETE_GRATIS_APARTIR_DE`; `services/shipping.ts` l.33 lê `config.FRETE_grátis_APARTIR_DE` (com acento) → `undefined`. Correção de 1 linha.
2. **Ordenação por preço não ordena:** `services/products.ts` l.43-46 — `price_asc`/`price_desc` caem no fallback `featured desc`.
3. **`GET /api/admin/health` público** (`routes/index.ts` l.847) — única rota admin sem `authMiddleware`.
4. **Idempotência de checkout em cache de memória** (`services/checkout.ts`, Map de 5 min) — perde em restart/multi-instância. Migrar para tabela (pedido por fingerprint/idempotency-key) com índice único.
5. **Assinatura de webhook simplificada** nos adapters (HMAC do body) — a verificação real do Mercado Pago usa `x-signature` (ts+v1). Corrigir no adapter quando a rota for criada.
6. **`hashPassword` com bcrypt 12** em `lib/crypto.ts` não é usado — rotas chamam `bcrypt.hash(...,10)` direto. Padronizar.
7. **Docs contam três histórias:** `docs/API.md` documenta endpoints inexistentes (webhooks, gateways CRUD, chargebacks, cupons CRUD, usuários, audit-log); `schema.ts` omitiu 5 tabelas e várias colunas que o `migrate.ts` cria; `DATABASE_DESIGN.md` cita cupom `BEMVINDO10` que o seed não cria. Reconciliar docs ↔ código ao final de cada fase.
8. **Testes-raiz `vitest/` são teatro:** 6 arquivos que reimplementam a lógica com pesos diferentes e testam a cópia (`fraud-test.test.ts` usa +30/+50/+40/+60; o serviço real usa +25/+20/+15/+15/+40/+10/+20). A única suite real é `services/checkout.test.ts`. Os placeholders violam a regra da própria SKILL — substituir por testes que importem o código de produção.
9. **Rate-limit global único** (100 req/min) — sem limite específico em login/checkout/busca.

---

## 6. Segurança — posição atual

| Controle | Estado |
|---|---|
| Validação de entrada | ✅ zod em todas as rotas (schemas compartilhados) |
| Senhas | ✅ bcrypt (custo a padronizar) |
| JWT httpOnly | ✅ cliente 24h, admin 12h |
| RBAC | ❌ definido, não aplicado |
| MFA admin | ❌ schema sim, código não |
| Rate limit | ⚠️ global apenas |
| Credenciais de gateway | ✅ AES-256-GCM em `gateway_configs` |
| Audit log | ✅ append-only nas mutações principais |
| Headers/CORS | ✅ helmet + cors com credentials |
| Upload | ❌ sem rota (sem validação de tipo/tamanho porque não existe) |

---

## 7. Ordem de execução corrigida (sobre os arquivos reais)

A spec pede header → homepage → catálogo → produto → comercial → admin. Com o achado do webhook e do catálogo importado, a sequência que minimiza retrabalho é:

| Fase | Entrega verificável |
|---|---|
| **A — Fundação de dados** | Alinhar `schema.ts` ↔ `migrate.ts` (adotar as 5 tabelas órfãs + colunas extras no schema); fix dos bugs 1, 2, 3; seed do catálogo importando `catalog.seed.json` (40 categorias hierárquicas + 261 produtos + variantes/estoque), download das imagens para storage local via nova rota de upload |
| **B — CMS comercial** | Schema/rotas/admin para `banners` + `homepage_sections`; `/api/store/home` lê a configuração (ordem/ativo/títulos/vitrines manuais); admin monta a homepage sem código |
| **C — Catálogo + produto** | Ordenação por preço real; filtros (preço, disponibilidade, marca); PDP completa (galeria, variações, specs, relacionados, CEP na página, 18+) |
| **D — Comercial** | Checkout completo (escolha de frete, parcelamento, revisão); tela de pagamento (QR PIX/boleto); confirmação; **rota de webhook com idempotência**; conta do cliente (pedidos, endereços, rastreio) |
| **E — Admin** | Dashboard real, pedidos, estoque, antifraude/chargeback (com PDF), cupons, marcas, categorias, campanhas; RBAC aplicado |
| **F — Qualidade** | Substituir testes-teatro por testes reais; rate-limit específico; docs reconciliados; responsividade; `README`/`.env.example` atualizados (`NEXT_PUBLIC_API_URL` ausente do exemplo) |

Não recriar: checkout transacional, antifraude, adapters de pagamento, auth, carrinho, mega menu, homepage base — evoluir no lugar.

---

## 8. Dependências externas (sem credencial = não declarar pronto)

| Integração | Estado | Bloqueio |
|---|---|---|
| Mercado Pago / PagBank / Cielo | Adapter real escrito; teste só em sandbox | Credenciais do lojista + verificação real de assinatura MP |
| Correios / Melhor Envio | Simulação por faixa de CEP | Escolha do provedor; `CORREIOS_CEP_API` declarada e não lida |
| 3DS 2.x | Flag em `gateway_configs`, não implementado | Depende do gateway escolhido |
| WhatsApp de atendimento | Campo no `.env.example` vazio | Número do lojista |
| Logo final | `LOGO.png` (1,9 MB) marcada como placeholder na SKILL | Arte final do cliente |

---

## 9. Critério de aceite mapeado (da spec)

- [ ] Homepage com todas as seções comerciais, alimentadas pelo admin → Fase B
- [ ] Menu com departamentos e subcategorias dinâmicos → A + C
- [ ] Catálogo com filtros funcionando → C
- [ ] Página de produto completa → C
- [ ] Carrinho + checkout + pedidos persistidos → D
- [ ] Admin administrando dados reais → E
- [ ] Desktop + mobile → F
- [ ] Identidade AIRSOFT AMERICANA consistente (paleta `#080A08/#111411/#8BCF16/#A6F51B/#C8CBC8/#F4F5F2`, sem vermelho/azul) → tokens já corretos em `globals.css`; manter em todas as telas novas

# Regras do projeto Airsoft Americana

- Antes de criar ou alterar qualquer UI, carregue a skill `design-comercial-profissional` e siga o checklist dela (seção 8: "Checklist de auditoria antes de entregar").
- Antes de qualquer trabalho no sistema (backend, admin, loja), carregue a skill `reconstrucao-airsoftamericana` — ela define o escopo, as regras duras e os critérios de encerramento.
- Proibido: dados inventados (produtos, preços, depoimentos, métricas, prazos, selos), gradientes decorativos, cards genéricos repetidos, botões sem ação, links `#`.
- Regras comerciais (frete grátis, desconto PIX, parcelamento, troca) vêm de uma única fonte no backend (`/api/store/settings` e equivalentes no admin). Jamais hardcode de valor em componente — o site antigo exibia R$700 numa página e R$699 noutra e perde venda por isso.
- Nunca copie código, texto, imagem ou nome de classe de sites de terceiros (o espelho `mirror/` foi removido da workspace em 2026-11-09; capacidades observadas do site antigo ficam em `docs/FEATURES_INVENTORY.md` como inventário funcional — referência de auditoria, nunca fonte de código).
- Estrutura: `apps/store` (loja, porta 3000), `apps/api` (Fastify, porta 4000), `apps/admin` (painel, porta 3001), `packages/shared` (domínio), `docs` (contratos e auditorias), `scripts` (utilitários). Material morto em `docs/legacy-zero-dep/`. Nada de arquivo solto na raiz além de configs, `README.md`, `AGENTS.md` e `iniciar.bat`.
- Valores financeiros em centavos (integer). Preço/desconto/frete/total sempre recalculados no servidor.
- Testes: função sem teste = não concluída (`SKILL.md` §7). Rode `npm test` e `npx tsc --noEmit` antes de fechar qualquer mudança de código.

# QA Checklist - Airsoft Americana

## Visual / Design
- [ ] Contraste AA >= 4.5:1 em textos e inputs
- [ ] Nenhum bg-[#0a0a0a] / text-white em telas de conteúdo
- [ ] Cards usam .card / .skeleton dos tokens
- [ ] Bordas em #e5e7eb
- [ ] Tipografia: Barlow Condensed títulos, Inter corpo, IBM Plex Mono mono
- [ ] Espaçamento 8px grid, assimetria proposital
- [ ] Ruído sutil e rotação sutil no hero

## Conteúdo / Voz Humana
- [ ] Sem textos genéricos de IA
- [ ] Microcópias conversacionais
- [ ] Números quebrados e data real
- [ ] Footer com história real

## Funcional
- [ ] Inputs unificados .input
- [ ] Estados loading/vazio/erro/sucesso padronizados
- [ ] Acessibilidade OK

## SEO / Técnico
- [ ] Meta tags, OG, JSON-LD
- [ ] lang pt-BR
- [ ] Sitemap limpo

## Comando de verificação de contraste
npx pa11y-ci http://localhost:3000 --standard WCAG2AA

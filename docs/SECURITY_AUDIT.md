# Auditoria de segurança — espelho anterior (resumo)

| Achado | Impacto | Correção na nova base |
|---|---|---|
| Checkout TiendaNube com scripts de terceiros (analytics, tags) | Vazamento de dados de sessão; superfície de injeção | Nenhum script de terceiro; `data:only` same-origin; headers de segurança |
| Dados de cartão transitavam no checkout do espelho | Escopo PCI DSS completo | Tokenização no provedor; nunca armazenar PAN/CVV |
| Sem antifraude configurável | Chargeback aceito pelo banco | Score de risco pré-captura, 3 faixas, captura posterior, 3DS onde o provedor suporta |
| Sem auditoria de alterações | Sem defesa em disputa | `audit_logs`, `order_status_history`, `payment_events` append-only |
| Sem controle de volume de pedidos | Exploração de promoção/estoque | `order_volume_limits` editável + uso em tempo real |
| jQuery 1.11.1 antigo | XSS conhecido | Next.js 16 + React 19 modernos |

## Controles implementados
Validação zod em todas as entradas; RBAC por papel; JWT + cookies httpOnly; rate-limit em login/checkout/busca; webhooks HMAC + idempotência; segredos só em `.env`; uploads validados; log estruturado sem dados sensíveis.

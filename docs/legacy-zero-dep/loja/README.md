# Airsoft Americana — Loja (backend + vitrine + admin)
Requisitos: Node >= 22.13 (usa `node:sqlite`, zero dependências).

## Executar
    ADMIN_EMAIL=voce@loja.com ADMIN_PASSWORD='senha-forte' PAY_WEBHOOK_SECRET='segredo' WHATSAPP=55DDDNUMERO npm start
Loja: http://localhost:3000 · Admin: http://localhost:3000/admin · Testes: `npm test`

## Variáveis
ADMIN_EMAIL/ADMIN_PASSWORD (cria o 1º admin) · PAY_WEBHOOK_SECRET (HMAC-SHA256 do corpo no header `x-signature`) · FRAUD_LIMIT_CENTS (padrão 500000: pedidos acima vão para fraude=`revisar`) · WHATSAPP · DB_FILE · PORT

## Publicação
VPS com Node 22 + systemd/pm2 atrás de Nginx/Caddy com HTTPS; volume persistente para `loja.db`; backup diário do arquivo (`sqlite3 loja.db ".backup"`).

## Pendente / depende de credenciais
Gateway de pagamento (criar cobrança e mapear o webhook ao formato `{event_id,order_id,status:paid|failed}`) · frete (`/api/shipping` retorna 501 até configurar Correios/JadLog) · cadastro/login de clientes, endereços salvos e rastreio de pedido · e-mails transacionais · upload de imagens (hoje URLs) · política de privacidade/termos (LGPD) · testes E2E/responsivos no navegador · formulários de admin dedicados (hoje edição por JSON).

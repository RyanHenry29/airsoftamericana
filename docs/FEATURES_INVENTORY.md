# Inventário funcional — levantamento do espelho (base: site antigo GM Tático/TiendaNube)

Mapeado a partir do HTML salvo. Status = o que a nova plataforma entrega.

| Módulo | No espelho | Status novo |
|---|---|---|
| Catálogo | Categorias Airsoft, Tiro Esportivo, Upgrades, Loadout, Life Style, Aventura, Promoções | `categories` + storefront com filtros/busca/ordenação/paginação/SEO |
| Produtos | Preços, descontos, parcelamento, disponibilidade | PDP com galeria, variantes, parcelamento, desconto PIX, frete por CEP, relacionados, 18+ |
| Carrinho | Adição/remoção/subtotal, desconto PIX | Carrinho persistente + cupom + frete recalculados no servidor |
| Frete | Correios, frete grátis | `/api/shipping/quote` por CEP+peso, frete grátis condicionado |
| Pagamentos | Cartão (Visa, Mastercard, Elo, Amex, Hipercard), PIX, boleto, parcelamento | Camada plugável por gateway (sandbox, Mercado Pago, PagBank, Cielo). O lojista escolhe no admin |
| Clientes | Login, cadastro, acompanhamento | Auth de cliente + pedidos rastreados + LGPD no admin |
| Pedidos | Compra e rastreamento | Máquina de estados completa + histórico imutável + expedição/rastreio |
| Marketing | Cupons, newsletter, ofertas | Cupons por valor/percentual/frete, banners, destaques, promoções |
| Atendimento | WhatsApp, loja física Americana, páginas informativas | WhatsApp configurável, `/quem-somos`, `/atendimento`, blog placeholder |
| Estoque | Indisponível/esgotado | Físico/reservado/disponível, movimentos com motivo, alertas, reservas transacionais |
| Chargeback | Reclamação: banco aceitava disputa fácil | Score de risco pré-captura, 3 faixas, 3DS, captura posterior, central de disputas, evidências em PDF, listas de monitoramento |

## Divergências assumidas (documentadas)
- **Gateway não presumido:** nenhuma credencial do espelho foi reutilizada. Adapters reais para MP/PagBank/Cielo + sandbox rotulado.
- **Catálogo de produtos:** seed cria categorias e produtos de exemplo a partir dos nomes visíveis no espelho — sem copiar imagens/HTML de terceiros.

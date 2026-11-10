// language: TSX, file: apps/store/src/app/conta/OrderDetailModal.tsx, target: Next.js App Router
// Modal do pedido: ESPIAR mostra status, pagamento, totais, endereço e itens;
// COMPRAR deixa escolher variante (cor/tamanho) e quantidade por item e
// adiciona no carrinho somando o que já está lá (POST define quantidade
// absoluta). 409 insufficient_stock é exibido por item com o disponível.
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Eye, ShoppingCart, X } from "lucide-react";
import { API_URL, fetchWithTimeout } from "../lib/store";
import { PAY_LABEL, STATUS_LABEL, brl, dateBr } from "./order-labels";

type BuyVariant = { id: string; name: string; priceCents: number };

type DetailItem = {
  id: string;
  variantId: string;
  sku: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  productSlug: string | null;
  variants: BuyVariant[];
};

type DetailOrder = {
  id: string;
  number: string;
  status: string;
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  totalCents: number;
  paymentMethod: "pix" | "cartao" | "boleto" | null;
  addressJson: Record<string, string | null | undefined> | null;
  customerNotes?: string | null;
  createdAt: string;
};

type OrderDetail = { order: DetailOrder; items: DetailItem[] };

type Choice = { variantId: string; qty: number };

function buyable(item: DetailItem) {
  return Boolean(item.productSlug) && item.variants.length > 0;
}

/** Variante padrão: a comprada no pedido se ainda estiver ativa; senão a primeira. */
function defaultVariant(item: DetailItem): BuyVariant | null {
  if (!buyable(item)) return null;
  return item.variants.find((v) => v.id === item.variantId) ?? item.variants[0] ?? null;
}

function AddressBlock({ address }: { address: DetailOrder["addressJson"] }) {
  if (!address) return null;
  const line1 = [address.street, address.number].filter(Boolean).join(", ");
  const line2 = [address.neighborhood, address.city, address.state].filter(Boolean).join(" · ");
  return (
    <div className="omodal__block">
      <span className="omodal__label">Endereço de entrega</span>
      <p className="omodal__addr">
        {address.recipient && <>{address.recipient}<br /></>}
        {line1}
        {address.complement && <> — {address.complement}</>}
        <br />
        {line2}
        {address.zip && <> · CEP {address.zip}</>}
      </p>
    </div>
  );
}

export function OrderDetailModal({
  orderNumber,
  mode,
  onClose,
}: {
  orderNumber: string;
  mode: "espiar" | "comprar";
  onClose: () => void;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"espiar" | "comprar">(mode);
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState("");
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(0);
  const [itemErrors, setItemErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetchWithTimeout(`${API_URL}/api/orders/${encodeURIComponent(orderNumber)}`, {
          credentials: "include",
        });
        const json = (await res.json().catch(() => ({}))) as {
          order?: DetailOrder;
          items?: DetailItem[];
          error?: { message?: string };
        };
        if (!alive) return;
        if (!res.ok || !json.order) {
          setFailure(json.error?.message ?? "Pedido não encontrado.");
          return;
        }
        const items = json.items ?? [];
        setDetail({ order: json.order, items });
        const initial: Record<string, Choice> = {};
        for (const item of items) {
          const v = defaultVariant(item);
          if (v) initial[item.id] = { variantId: v.id, qty: Math.min(999, Math.max(1, item.quantity)) };
        }
        setChoices(initial);
      } catch {
        if (alive) setFailure("Erro de conexão com a API.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [orderNumber]);

  // Esc fecha; trava o scroll do fundo enquanto o modal está aberto.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const setVariant = useCallback((itemId: string, variantId: string) => {
    setChoices((c) => ({ ...c, [itemId]: { variantId, qty: c[itemId]?.qty ?? 1 } }));
  }, []);

  const setQty = useCallback((itemId: string, qty: number) => {
    const clamped = Number.isFinite(qty) ? Math.min(999, Math.max(1, Math.floor(qty))) : 1;
    setChoices((c) => ({
      ...c,
      [itemId]: { variantId: c[itemId]?.variantId ?? "", qty: clamped },
    }));
  }, []);

  async function addAll() {
    if (!detail) return;
    setBusy(true);
    setItemErrors({});
    setAdded(0);
    try {
      // agregado por variante: dois itens do pedido podem virar a mesma opção
      const desired = new Map<string, number>();
      for (const item of detail.items) {
        if (!buyable(item)) continue;
        const choice = choices[item.id];
        if (!choice || choice.qty < 1) continue;
        desired.set(choice.variantId, (desired.get(choice.variantId) ?? 0) + choice.qty);
      }
      if (desired.size === 0) {
        setFailure("Nenhum item disponível para recompra.");
        return;
      }

      const cartRes = await fetchWithTimeout(`${API_URL}/api/cart`, { credentials: "include" });
      const cart = (await cartRes.json().catch(() => ({}))) as {
        items?: Array<{ variantId: string; quantity: number }>;
      };
      const existing = new Map((cart.items ?? []).map((i) => [i.variantId, i.quantity]));

      const errors: Record<string, string> = {};
      let okCount = 0;
      for (const [variantId, qty] of desired) {
        // POST /api/cart/items define quantidade absoluta — soma com o carrinho
        const target = Math.min(999, (existing.get(variantId) ?? 0) + qty);
        try {
          const res = await fetchWithTimeout(`${API_URL}/api/cart/items`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ variantId, quantity: target }),
          });
          const json = (await res.json().catch(() => ({}))) as {
            error?: { code?: string; message?: string; available?: number };
          };
          if (res.ok) {
            okCount += 1;
          } else if (res.status === 409 && json.error?.code === "insufficient_stock") {
            const available = json.error.available ?? 0;
            for (const item of detail.items) {
              if (choices[item.id]?.variantId === variantId) {
                errors[item.id] =
                  available > 0
                    ? `Só ${available} unidade${available > 1 ? "s" : ""} em estoque.`
                    : "Sem estoque no momento.";
              }
            }
          } else {
            const msg = json.error?.message ?? "Falha ao adicionar.";
            for (const item of detail.items) {
              if (choices[item.id]?.variantId === variantId) errors[item.id] = msg;
            }
          }
        } catch {
          for (const item of detail.items) {
            if (choices[item.id]?.variantId === variantId) errors[item.id] = "Erro de conexão.";
          }
        }
      }

      setItemErrors(errors);
      setAdded(okCount);
      if (okCount > 0) router.refresh();
    } catch {
      setFailure("Erro de conexão com a API.");
    } finally {
      setBusy(false);
    }
  }

  const order = detail?.order;
  const items = detail?.items ?? [];

  return (
    <div
      className="omodal"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="omodal__panel" role="dialog" aria-modal="true" aria-label={`Pedido ${orderNumber}`}>
        <header className="omodal__head">
          <div className="omodal__head-text">
            <span className="omodal__kicker">PEDIDO {orderNumber}</span>
            {order && (
              <div className="omodal__meta">
                <span className="conta-order__status" data-status={order.status}>
                  {STATUS_LABEL[order.status] ?? order.status}
                </span>
                <span className="omodal__meta-item">
                  {order.paymentMethod ? PAY_LABEL[order.paymentMethod] ?? "—" : "—"}
                </span>
                <span className="omodal__meta-item">{dateBr(order.createdAt)}</span>
              </div>
            )}
          </div>
          <div className="omodal__head-actions">
            <div className="omodal__tabs" role="tablist" aria-label="Modo do pedido">
              <button
                type="button"
                role="tab"
                aria-selected={tab === "espiar"}
                className={`omodal__tab ${tab === "espiar" ? "omodal__tab--on" : ""}`}
                onClick={() => setTab("espiar")}
              >
                <Eye size={13} strokeWidth={2} aria-hidden="true" /> ESPIAR
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "comprar"}
                className={`omodal__tab ${tab === "comprar" ? "omodal__tab--on" : ""}`}
                onClick={() => setTab("comprar")}
              >
                <ShoppingCart size={13} strokeWidth={2} aria-hidden="true" /> COMPRAR
              </button>
            </div>
            <button type="button" className="omodal__close" onClick={onClose} aria-label="Fechar">
              <X size={18} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="omodal__body">
          {loading && (
            <div className="omodal__loading" aria-live="polite">
              <span className="omodal__skeleton omodal__skeleton--title" />
              <span className="omodal__skeleton" />
              <span className="omodal__skeleton" />
              <span className="omodal__skeleton omodal__skeleton--short" />
            </div>
          )}

          {!loading && failure && <p className="omodal__failure" role="alert">{failure}</p>}

          {!loading && !failure && order && (
            <>
              <section className="omodal__totals" aria-label="Valores do pedido">
                <div className="omodal__total-row">
                  <span>Subtotal</span>
                  <strong>{brl(order.subtotalCents)}</strong>
                </div>
                {order.discountCents > 0 && (
                  <div className="omodal__total-row omodal__total-row--off">
                    <span>Desconto</span>
                    <strong>− {brl(order.discountCents)}</strong>
                  </div>
                )}
                <div className="omodal__total-row">
                  <span>Frete</span>
                  <strong>{order.shippingCents > 0 ? brl(order.shippingCents) : "Grátis"}</strong>
                </div>
                <div className="omodal__total-row omodal__total-row--grand">
                  <span>Total</span>
                  <strong>{brl(order.totalCents)}</strong>
                </div>
              </section>

              <AddressBlock address={order.addressJson} />

              {order.customerNotes && (
                <div className="omodal__block">
                  <span className="omodal__label">Observação</span>
                  <p className="omodal__addr">{order.customerNotes}</p>
                </div>
              )}

              <section className="omodal__block" aria-label="Itens do pedido">
                <span className="omodal__label">Itens</span>
                <ul className="omodal__items">
                  {items.map((item) => {
                    const canBuy = buyable(item);
                    const choice = choices[item.id];
                    const chosen = choice ? item.variants.find((v) => v.id === choice.variantId) : null;
                    return (
                      <li key={item.id} className={`omodal__item ${!canBuy && tab === "comprar" ? "omodal__item--off" : ""}`}>
                        <div className="omodal__item-info">
                          <strong className="omodal__item-name">
                            {canBuy && item.productSlug ? (
                              <Link href={`/${item.productSlug}`} onClick={onClose}>
                                {item.name}
                              </Link>
                            ) : (
                              item.name
                            )}
                          </strong>
                          <span className="omodal__item-sku">
                            SKU {item.sku} · {item.quantity} un. · {brl(item.unitPriceCents)} cada
                          </span>
                          {itemErrors[item.id] && (
                            <span className="omodal__item-error" role="alert">
                              {itemErrors[item.id]}
                            </span>
                          )}
                        </div>
                        <div className="omodal__item-side">
                          <span className="omodal__item-total">{brl(item.totalCents)}</span>
                          {tab === "comprar" &&
                            (canBuy && choice ? (
                              <div className="omodal__controls">
                                {item.variants.length > 1 && (
                                  <select
                                    className="omodal__select"
                                    aria-label={`Opção de ${item.name}`}
                                    value={choice.variantId}
                                    onChange={(e) => setVariant(item.id, e.target.value)}
                                  >
                                    {item.variants.map((v) => (
                                      <option key={v.id} value={v.id}>
                                        {v.name} — {brl(v.priceCents)}
                                      </option>
                                    ))}
                                  </select>
                                )}
                                <div className="omodal__qty" aria-label={`Quantidade de ${item.name}`}>
                                  <button
                                    type="button"
                                    onClick={() => setQty(item.id, choice.qty - 1)}
                                    disabled={choice.qty <= 1}
                                    aria-label="Diminuir quantidade"
                                  >
                                    −
                                  </button>
                                  <input
                                    type="number"
                                    min={1}
                                    max={999}
                                    value={choice.qty}
                                    aria-label={`Quantidade de ${item.name}`}
                                    onChange={(e) => setQty(item.id, Number(e.target.value))}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => setQty(item.id, choice.qty + 1)}
                                    disabled={choice.qty >= 999}
                                    aria-label="Aumentar quantidade"
                                  >
                                    +
                                  </button>
                                </div>
                                {chosen && <span className="omodal__chosen">{chosen.name}</span>}
                              </div>
                            ) : (
                              <span className="omodal__na">indisponível</span>
                            ))}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            </>
          )}
        </div>

        {tab === "comprar" && !loading && !failure && order && (
          <footer className="omodal__foot">
            {added > 0 && (
              <span className="omodal__added" role="status">
                {added} {added === 1 ? "item adicionado" : "itens adicionados"}
              </span>
            )}
            {added > 0 ? (
              <div className="omodal__foot-actions">
                <Link href="/cart" className="btn-primary" onClick={onClose}>
                  Ir para o carrinho
                </Link>
                <button type="button" className="btn-ghost" onClick={onClose}>
                  Continuar na conta
                </button>
              </div>
            ) : (
              <button type="button" className="btn-primary" disabled={busy} onClick={addAll}>
                <ShoppingCart size={15} strokeWidth={2} aria-hidden="true" />
                {busy ? "Adicionando…" : "Adicionar tudo ao carrinho"}
              </button>
            )}
          </footer>
        )}
      </div>
    </div>
  );
}

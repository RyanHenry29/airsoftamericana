// language: TSX, file: apps/store/src/app/checkout/CheckoutForm.tsx, target: Next.js App Router
// Checkout profissional — dark theme, etapas claras, cálculo no servidor
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useCallback } from "react";
import { ShieldCheck, Truck, Zap, MapPin, CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import { fetchViaCep, formatCep, mergeCepLookup } from "../lib/viacep";

const API_URL = "";

type Pay = "pix" | "cartao" | "boleto";

const OPTIONS: { id: Pay; name: string; desc: string; tag: string }[] = [
  { id: "pix", name: "PIX", desc: "Desconto à vista", tag: "PX" },
  { id: "cartao", name: "Cartão", desc: "Parcelamento sem juros", tag: "CR" },
  { id: "boleto", name: "Boleto", desc: "Compensa em 1-2 dias", tag: "BL" },
];

type CartItem = { variantId: string; quantity: number; ageRestricted?: boolean };

/* ───────── hook de CEP com debounce + cache ───────── */
function useCepLookup() {
  const [status, setStatus] = useState<"idle" | "busy" | "ok" | "miss">("idle");
  const [foundAddress, setFoundAddress] = useState<{ street: string; neighborhood: string; city: string; state: string } | null>(null);
  const doneRef = useRef<string>("");        // CEPs já consultados com sucesso
  const missRef = useRef<string>("");        // CEPs que não existem na base
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lookup = useCallback(async (value: string) => {
    const digits = value.replace(/\D/g, "");
    if (digits.length !== 8) { setStatus("idle"); setFoundAddress(null); return; }
    if (doneRef.current === digits) { setStatus("ok"); return; }
    if (missRef.current === digits) { setStatus("miss"); setFoundAddress(null); return; }

    if (timerRef.current) clearTimeout(timerRef.current);
    setStatus("busy");

    timerRef.current = setTimeout(async () => {
      try {
        const found = await fetchViaCep(digits);
        if (!found) {
          missRef.current = digits;
          setFoundAddress(null);
          setStatus("miss");
          return;
        }
        doneRef.current = digits;
        setFoundAddress({ street: found.street, neighborhood: found.neighborhood, city: found.city, state: found.state });
        setStatus("ok");
      } catch {
        setFoundAddress(null);
        setStatus("miss");
      }
    }, 180); // debounce leve
  }, []);

  const apply = useCallback((form: { zip: string; street: string; neighborhood: string; city: string; state: string; number: string; complement: string }) => {
    if (!foundAddress) return form;
    return mergeCepLookup(form, { zip: "", street: foundAddress.street, neighborhood: foundAddress.neighborhood, city: foundAddress.city, state: foundAddress.state } as any);
  }, [foundAddress]);

  const reset = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setStatus("idle");
    setFoundAddress(null);
  }, []);

  return { status, foundAddress, lookup };
}

export function CheckoutForm() {
  const router = useRouter();
  const [pay, setPay] = useState<Pay>("pix");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [cartAgeRestricted, setCartAgeRestricted] = useState(false);
  const [needLogin, setNeedLogin] = useState(false);
  const [data, setData] = useState({
    recipient: "",
    zip: "",
    street: "",
    number: "",
    complement: "",
    neighborhood: "",
    city: "",
    state: "",
    notes: "",
    coupon: "",
    terms: false,
    ageConfirmed: false,
  });

  const { status, foundAddress, lookup } = useCepLookup();

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${API_URL}/api/cart`, { credentials: "include" });
        const json = (await res.json().catch(() => ({}))) as { items?: CartItem[]; ageRestricted?: boolean };
        setCartItems(json.items ?? []);
        setCartAgeRestricted(Boolean(json.ageRestricted));
      } catch { /* offline */ }
      try {
        const me = await fetch(`${API_URL}/api/auth/me`, { credentials: "include" });
        if (!me.ok) {
          setNeedLogin(true);
        } else {
          // Endereço padrão da conta preenche o formulário (só campos vazios).
          try {
            const adr = await fetch(`${API_URL}/api/customer/addresses`, { credentials: "include" });
            const json = (await adr.json().catch(() => ({}))) as {
              items?: {
                recipient: string;
                zip: string;
                street: string;
                number: string;
                complement: string | null;
                neighborhood: string;
                city: string;
                state: string;
                isDefault: boolean;
              }[];
            };
            // a API devolve o padrão primeiro
            const def = (json.items ?? [])[0];
            if (adr.ok && def) {
              setData((d) => ({
                ...d,
                recipient: d.recipient || def.recipient,
                zip: d.zip || formatCep(def.zip),
                street: d.street || def.street,
                number: d.number || def.number,
                complement: d.complement || def.complement || "",
                neighborhood: d.neighborhood || def.neighborhood,
                city: d.city || def.city,
                state: d.state || def.state,
              }));
            }
          } catch { /* sem endereço salvo: o cliente preenche à mão */ }
        }
      } catch { setNeedLogin(true); }
    }
    load();
  }, []);

  const set = (k: keyof typeof data) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setData((d) => ({ ...d, [k]: e.target.value }));

  function onZipChange(e: React.ChangeEvent<HTMLInputElement>) {
    const masked = formatCep(e.target.value);
    setData((d) => ({ ...d, zip: masked }));
    lookup(masked);
  }

  // Aplica o endereço encontrado nos campos vazios
  useEffect(() => {
    if (status === "ok" && foundAddress) {
      setData((d) => ({
        ...d,
        street: d.street || foundAddress.street,
        neighborhood: d.neighborhood || foundAddress.neighborhood,
        city: d.city || foundAddress.city,
        state: d.state || foundAddress.state,
      }));
    }
  }, [status, foundAddress]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!data.terms) { setError("Aceite os termos de compra para continuar."); return; }
    if (cartAgeRestricted && !data.ageConfirmed) { setError("Confirme que você tem 18 anos ou mais para comprar itens com restrição etária."); return; }
    if (cartItems.length === 0) { setError("Seu carrinho está vazio. Adicione um item antes de finalizar."); return; }
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/api/checkout`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          items: cartItems.map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
          address: {
            recipient: data.recipient.trim(),
            zip: data.zip.replace(/\D/g, ""),
            street: data.street.trim(),
            number: data.number.trim(),
            complement: data.complement.trim() || undefined,
            neighborhood: data.neighborhood.trim(),
            city: data.city.trim(),
            state: data.state.trim().toUpperCase(),
            country: "BR",
          },
          paymentMethod: pay,
          couponCode: data.coupon.trim().toUpperCase() || undefined,
          customerNotes: data.notes.trim() || undefined,
          acceptedTerms: true,
          ...(cartAgeRestricted ? { ageConfirmed: true } : {}),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
        orderNumber?: string;
        status?: string;
        payment?: { status?: string };
      };
      if (!res.ok) {
        if (res.status === 401) { setNeedLogin(true); setError("Você precisa entrar na conta para finalizar a compra."); return; }
        setError(json.error?.message ?? "Falha ao finalizar. Tente de novo.");
        return;
      }
      setSuccess(`Pedido ${json.orderNumber ?? ""} criado (${json.status ?? ""}). Pagamento: ${json.payment?.status ?? "pendente"}.`);
      router.refresh();
    } catch { setError("Erro de conexão com a API."); }
    finally { setBusy(false); }
  }

  return (
    <form className="checkout-form" onSubmit={onSubmit} noValidate>
      <div className="checkout-form__main">
        {needLogin && (
          <div className="checkout-alert">
            <p className="checkout-alert__title">Entre pra finalizar</p>
            <p className="checkout-alert__text">O checkout exige conta para criar o pedido e reservar o estoque.</p>
            <div className="checkout-alert__actions">
              <Link href="/entrar" className="btn-primary">ENTRAR</Link>
              <Link href="/cadastro" className="btn-ghost">Criar conta</Link>
            </div>
          </div>
        )}

        <section className="checkout-section" aria-labelledby="endereco-title">
          <h2 id="endereco-title" className="checkout-section__title">Endereço de entrega</h2>
          <div className="checkout-grid">
            <div className="checkout-field">
              <label htmlFor="recipient" className="checkout-label">Quem vai receber</label>
              <input id="recipient" className="checkout-input" autoComplete="name" value={data.recipient} onChange={set("recipient")} required />
            </div>
            <div className="checkout-field">
              <label htmlFor="zip" className="checkout-label">CEP</label>
              <div className="relative">
                <input
                  id="zip"
                  className="checkout-input pr-12"
                  inputMode="numeric"
                  placeholder="00000-000"
                  autoComplete="postal-code"
                  value={data.zip}
                  onChange={onZipChange}
                  maxLength={9}
                  required
                />
                {status === "busy" && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-primary" aria-hidden="true">
                    <Loader2 size={18} className="animate-spin" />
                  </span>
                )}
                {status === "ok" && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--primary-dark)]" aria-hidden="true">
                    <CheckCircle2 size={18} strokeWidth={3} />
                  </span>
                )}
                {status === "miss" && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[#f87171]" aria-hidden="true">
                    <AlertCircle size={18} strokeWidth={2.2} />
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-sm" style={{ color: status === "busy" ? "var(--primary)" : status === "ok" ? "var(--primary-dark)" : status === "miss" ? "#f87171" : "var(--muted-foreground)" }}>
                {status === "busy" && "Buscando CEP na ViaCEP…"}
                {status === "ok" && "Endereço encontrado — confira e complete o número."}
                {status === "miss" && "CEP não encontrado na base — preencha os campos manualmente."}
              </p>
            </div>

            {/* Card de endereço preenchido automaticamente */}
            {status === "ok" && foundAddress && (
              <div className="checkout-field checkout-field--full checkout-address-card" style={{ gridColumn: "1 / -1" }}>
                <div className="flex items-start gap-3 p-4 rounded-[var(--radius)] border border-border bg-base">
                  <MapPin size={20} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground">{foundAddress.street}</p>
                    <p className="text-sm text-muted-foreground">
                      {foundAddress.neighborhood}, {foundAddress.city} - {foundAddress.state}
                    </p>
                    <p className="mt-1.5 text-xs text-muted-foreground/70">Digite o <strong>número</strong> e, se houver, o <strong>complemento</strong>.</p>
                  </div>
                </div>
              </div>
            )}
            <div className="checkout-field checkout-field--full">
              <label htmlFor="street" className="checkout-label">Rua</label>
              <input id="street" className="checkout-input" autoComplete="address-line1" value={data.street} onChange={set("street")} required />
            </div>
            <div className="checkout-field">
              <label htmlFor="number" className="checkout-label">Número</label>
              <input id="number" className="checkout-input" value={data.number} onChange={set("number")} required />
            </div>
            <div className="checkout-field">
              <label htmlFor="complement" className="checkout-label">Complemento (opcional)</label>
              <input id="complement" className="checkout-input" value={data.complement} onChange={set("complement")} />
            </div>
            <div className="checkout-field">
              <label htmlFor="neighborhood" className="checkout-label">Bairro</label>
              <input id="neighborhood" className="checkout-input" autoComplete="address-level2" value={data.neighborhood} onChange={set("neighborhood")} required />
            </div>
            <div className="checkout-field">
              <label htmlFor="city" className="checkout-label">Cidade</label>
              <input id="city" className="checkout-input" autoComplete="address-level2" value={data.city} onChange={set("city")} required />
            </div>
            <div className="checkout-field">
              <label htmlFor="state" className="checkout-label">UF</label>
              <input id="state" className="checkout-input" maxLength={2} placeholder="SP" value={data.state} onChange={set("state")} required />
            </div>
          </div>
        </section>

        <section className="checkout-section" aria-labelledby="pagamento-title">
          <h2 id="pagamento-title" className="checkout-section__title">Forma de pagamento</h2>
          <div className="checkout-pay-options" role="radiogroup" aria-label="Escolha a forma de pagamento">
            {OPTIONS.map((o) => (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={pay === o.id}
                className={`checkout-pay-option ${pay === o.id ? "is-active" : ""}`}
                onClick={() => setPay(o.id)}
              >
                <span className="checkout-pay-tag">{o.tag}</span>
                <span className="checkout-pay-name">{o.name}</span>
                <span className="checkout-pay-desc">{o.desc}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="checkout-section" aria-labelledby="extras-title">
          <h2 id="extras-title" className="checkout-section__title">Extras</h2>
          <div className="checkout-grid">
            <div className="checkout-field">
              <label htmlFor="coupon" className="checkout-label">Cupom (opcional)</label>
              <input id="coupon" className="checkout-input" placeholder="Ex: PIX5" value={data.coupon} onChange={set("coupon")} />
            </div>
            <div className="checkout-field">
              <label htmlFor="notes" className="checkout-label">Observações (opcional)</label>
              <input id="notes" className="checkout-input" value={data.notes} onChange={set("notes")} />
            </div>
          </div>
        </section>

        <fieldset className="checkout-terms">
          <legend className="checkout-terms__legend">Confirmações</legend>
          <label className="checkout-checkbox">
            <input
              type="checkbox"
              className="checkout-checkbox__input"
              checked={data.terms}
              onChange={(e) => setData({ ...data, terms: e.target.checked })}
              required
            />
            <span className="checkout-checkbox__text">
              Li e aceito os termos de compra e a política de entrega/troca. (Versão 1.0 — registrada com horário e IP no pedido.)
            </span>
          </label>

          {cartAgeRestricted && (
            <label className="checkout-checkbox checkout-checkbox--age">
              <input
                type="checkbox"
                className="checkout-checkbox__input"
                checked={data.ageConfirmed}
                onChange={(e) => setData({ ...data, ageConfirmed: e.target.checked })}
                required
              />
              <span className="checkout-checkbox__text">
                Confirmo que tenho 18 anos ou mais. Este pedido contém itens com restrição etária (airsoft/pressão) e a venda exige maioridade.
              </span>
            </label>
          )}
        </fieldset>

        {error && <p className="checkout-error" role="alert">{error}</p>}
        {success && <p className="checkout-success" role="status">{success}</p>}
      </div>

      <aside className="checkout-summary" aria-labelledby="resumo-title">
        <h2 id="resumo-title" className="checkout-summary__title">Resumo do pedido</h2>

        <div className="checkout-summary__row">
          <span className="checkout-summary__label">Itens</span>
          <span className="checkout-summary__value">{cartItems.reduce((a, i) => a + i.quantity, 0)} item(ns)</span>
        </div>

        <div className="checkout-summary__row">
          <span className="checkout-summary__label">Pagamento</span>
          <span className="checkout-summary__value checkout-summary__value--highlight">{pay.toUpperCase()}</span>
        </div>

        <div className="checkout-summary__row checkout-summary__row--total">
          <span className="checkout-summary__label">Total</span>
          <strong className="checkout-summary__value checkout-summary__value--total">a calcular</strong>
        </div>

        <button type="submit" className="btn-primary checkout-submit" disabled={busy}>
          {busy ? "Finalizando..." : "Finalizar compra"}
        </button>

        <p className="checkout-note">Preços, frete e totais recalculados no servidor. Você confirma só depois.</p>

        <div className="checkout-perks">
          <div className="checkout-perk"><ShieldCheck size={18} aria-hidden="true" /><span>Compra protegida</span></div>
          <div className="checkout-perk"><Truck size={18} aria-hidden="true" /><span>Envio para todo o Brasil</span></div>
          <div className="checkout-perk"><Zap size={18} aria-hidden="true" /><span>PIX com desconto</span></div>
        </div>
      </aside>
    </form>
  );
}
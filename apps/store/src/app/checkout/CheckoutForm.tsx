"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type Pay = "pix" | "cartao" | "boleto";

const OPTIONS: { id: Pay; name: string; desc: string; tag: string }[] = [
  { id: "pix", name: "PIX", desc: "5% de desconto na hora", tag: "PX" },
  { id: "cartao", name: "Cartão", desc: "até 3x sem juros", tag: "CR" },
  { id: "boleto", name: "Boleto", desc: "Compensa em 1-2 dias úteis", tag: "BL" },
];

type CartItem = { variantId: string; quantity: number };

export function CheckoutForm() {
  const router = useRouter();
  const [pay, setPay] = useState<Pay>("pix");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
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
  });

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${API_URL}/api/cart`, { credentials: "include" });
        const json = (await res.json().catch(() => ({}))) as { items?: CartItem[] };
        setCartItems(json.items ?? []);
      } catch {
        /* offline */
      }
      // Sessão em cookie httpOnly — confere no /me, sem token no localStorage.
      try {
        const me = await fetch(`${API_URL}/api/auth/me`, { credentials: "include" });
        if (!me.ok) setNeedLogin(true);
      } catch {
        setNeedLogin(true);
      }
    }
    load();
  }, []);

  const set = (k: keyof typeof data) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setData((d) => ({ ...d, [k]: e.target.value }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!data.terms) {
      setError("Aceite os termos de compra para continuar.");
      return;
    }
    if (cartItems.length === 0) {
      setError("Seu carrinho está vazio. Adicione um item antes de finalizar.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/api/checkout`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          items: cartItems,
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
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
        orderNumber?: string;
        status?: string;
        payment?: { status?: string };
      };
      if (!res.ok) {
        if (res.status === 401) {
          setNeedLogin(true);
          setError("Você precisa entrar na conta para finalizar a compra.");
          return;
        }
        setError(json.error?.message ?? "Falha ao finalizar. Tente de novo.");
        return;
      }
      setSuccess(
        `Pedido ${json.orderNumber ?? ""} criado (${json.status ?? ""}). Pagamento: ${json.payment?.status ?? "pendente"}.`,
      );
      router.refresh();
    } catch {
      setError("Erro de conexão com a API.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="grid grid-cols-1 lg:grid-cols-3 gap-10 items-start" onSubmit={onSubmit} noValidate>
      <div className="lg:col-span-2 space-y-10">
        {needLogin && (
          <div className="border border-[#e5e7eb] bg-white p-8 rounded-[2px]">
            <p className="font-display font-black uppercase text-[#111] mb-2">Entre pra finalizar</p>
            <p className="text-[#666] font-mono text-xs mb-6">
              O checkout exige conta para criar o pedido e reservar o estoque.
            </p>
            <div className="flex gap-4">
              <Link href="/entrar" className="btn-primary px-8 py-3">
                ENTRAR
              </Link>
              <Link href="/cadastro" className="font-mono text-xs uppercase tracking-widest text-[#8bcf16] hover:text-[#a6f51b] transition-colors underline underline-offset-4">
                Criar conta
              </Link>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="field">
            <label className="font-mono text-[0.6rem] uppercase tracking-widest text-[#666] block mb-2">Quem vai receber</label>
            <input
              id="recipient"
              className="input"
              autoComplete="name"
              value={data.recipient}
              onChange={set("recipient")}
            />
          </div>
          <div className="field">
            <label className="font-mono text-[0.6rem] uppercase tracking-widest text-[#666] block mb-2">CEP</label>
            <input
              id="zip"
              className="input"
              inputMode="numeric"
              placeholder="00000-000"
              autoComplete="postal-code"
              value={data.zip}
              onChange={set("zip")}
            />
          </div>
          <div className="field md:col-span-2">
            <label className="font-mono text-[0.6rem] uppercase tracking-widest text-[#666] block mb-2">Rua</label>
            <input
              id="street"
              className="input"
              autoComplete="address-line1"
              value={data.street}
              onChange={set("street")}
            />
          </div>
          <div className="field">
            <label className="font-mono text-[0.6rem] uppercase tracking-widest text-[#666] block mb-2">Número</label>
            <input
              id="number"
              className="input"
              value={data.number}
              onChange={set("number")}
            />
          </div>
          <div className="field">
            <label className="font-mono text-[0.6rem] uppercase tracking-widest text-[#666] block mb-2">Complemento (opcional)</label>
            <input
              id="complement"
              className="input"
              value={data.complement}
              onChange={set("complement")}
            />
          </div>
          <div className="field">
            <label className="font-mono text-[0.6rem] uppercase tracking-widest text-[#666] block mb-2">Bairro</label>
            <input
              id="neighborhood"
              className="input"
              autoComplete="address-level2"
              value={data.neighborhood}
              onChange={set("neighborhood")}
            />
          </div>
          <div className="grid grid-cols-2 gap-6">
            <div className="field">
              <label className="font-mono text-[0.6rem] uppercase tracking-widest text-[#666] block mb-2">Cidade</label>
              <input
                id="city"
                className="input"
                autoComplete="address-level2"
                value={data.city}
                onChange={set("city")}
              />
            </div>
            <div className="field">
              <label className="font-mono text-[0.6rem] uppercase tracking-widest text-[#666] block mb-2">UF</label>
              <input
                id="state"
                className="input"
                maxLength={2}
                placeholder="SP"
                value={data.state}
                onChange={set("state")}
              />
            </div>
          </div>
        </div>

        <fieldset className="border border-[#e5e7eb] bg-white p-8 rounded-[2px]">
          <legend className="font-mono text-xs uppercase tracking-widest text-[#8bcf16] mb-6">
            Forma de pagamento
          </legend>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {OPTIONS.map((o) => (
              <button
                key={o.id}
                type="button"
                className={`flex flex-col items-center gap-2 p-4 border rounded-0 ${pay === o.id ? "border-[#8bcf16] bg-[#8bcf16]/10 text-[#8bcf16]" : "border-[#111] text-[#666] hover:border-[#8bcf16] hover:text-[#8bcf16] transition-colors"}`}
                aria-pressed={pay === o.id}
                onClick={() => setPay(o.id)}
              >
                <span className="font-display font-black text-lg uppercase">{o.tag}</span>
                <span className="font-mono text-[0.6rem] uppercase tracking-tighter text-[#111]">{o.name}</span>
                <span className="font-mono text-[0.55rem] uppercase tracking-tighter text-[#333]">{o.desc}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="field">
            <label className="font-mono text-[0.6rem] uppercase tracking-widest text-[#666] block mb-2">Cupom (opcional)</label>
            <input
              id="coupon"
              className="input"
              placeholder="Ex: PIX5"
              value={data.coupon}
              onChange={set("coupon")}
            />
          </div>
          <div className="field">
            <label className="font-mono text-[0.6rem] uppercase tracking-widest text-[#666] block mb-2">Observações (opcional)</label>
            <input
              id="notes"
              className="input"
              value={data.notes}
              onChange={set("notes")}
            />
          </div>
        </div>

        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 w-4 h-4 border border-[#111] rounded-0 bg-[#000] text-[#8bcf16] focus:ring-[#8bcf16]"
            checked={data.terms}
            onChange={(e) => setData({ ...data, terms: e.target.checked })}
          />
          <span className="font-mono text-xs leading-relaxed text-[#666]">
            Li e aceito os termos de compra e a política de entrega/troca. (Versão 1.0 — registrada com horário e IP no pedido.)
          </span>
        </label>

        <p className="mt-2 text-[#333] font-mono text-[0.6rem] uppercase tracking-widest">
          Maior de 18 anos para categorias restritas.
        </p>

        {error && (
          <p role="alert" className="mt-4 text-[#dc2626] font-mono text-xs font-bold">{error}</p>
        )}
        {success && (
          <p role="status" className="mt-4 text-[#8bcf16] font-mono text-xs font-bold">{success}</p>
        )}
      </div>

      <aside className="border border-[#e5e7eb] bg-white p-8 sticky top-24 rounded-[2px]">
        <span className="font-mono text-xs uppercase tracking-widest text-[#8bcf16] block mb-4">Resumo do pedido</span>
        <div className="flex justify-between items-baseline mb-6">
          <span className="font-mono text-xs uppercase tracking-widest text-[#666]">Itens</span>
          <span className="font-display font-black text-2xl text-[#111]">
            {cartItems.reduce((a, i) => a + i.quantity, 0)} item(ns)
          </span>
        </div>
        <div className="flex justify-between items-baseline mb-6">
          <span className="font-mono text-xs uppercase tracking-widest text-[#666]">Pagamento</span>
          <span className="font-display font-black text-2xl text-[#8bcf16] uppercase">{pay.toUpperCase()}</span>
        </div>
        <div className="flex justify-between items-baseline mb-8 border-t border-[#111] pt-4">
          <span className="font-display font-black text-2xl text-[#111]">Total</span>
          <b className="font-display font-black text-2xl text-[#8bcf16]">a calcular</b>
        </div>

        <button type="submit" className="w-full btn-primary py-4 text-base disabled:opacity-50 disabled:cursor-not-allowed" disabled={busy}>
          {busy ? "Finalizando..." : "Finalizar compra"}
        </button>
        <p className="mt-4 text-[#333] font-mono text-[0.6rem] uppercase tracking-widest leading-relaxed">
          Preços, frete e totais recalculados no servidor. Você confirma só depois.
        </p>
      </aside>
    </form>
  );
}

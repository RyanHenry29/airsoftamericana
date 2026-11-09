// language: TSX, file: apps/store/src/app/components/Header.tsx, target: Next.js App Router
// Cabeçalho comercial: barra de condições, busca com sugestão, ícones e menu de departamentos.
"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Menu, Search, ShoppingCart, User, X } from "lucide-react";
import { API_URL, formatBRL, type StoreSuggestion } from "../lib/store";

export function Header() {
  const router = useRouter();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [q, setQ] = useState("");
  const [suggestions, setSuggestions] = useState<StoreSuggestion | null>(null);
  const [count, setCount] = useState(0);
  const [settings, setSettings] = useState<{ free_shipping_from_cents: number; pix_discount_percent: number; installments: number } | null>(null);
  const [customer, setCustomer] = useState<{ name: string; email: string } | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${API_URL}/api/cart`, { credentials: "include" });
        const json = (await res.json().catch(() => ({}))) as { items?: { quantity: number }[] };
        setCount((json.items ?? []).reduce((a, i) => a + i.quantity, 0));
      } catch {
        /* offline */
      }
      try {
        const me = await fetch(`${API_URL}/api/auth/me`, { credentials: "include" });
        if (me.ok) {
          const json = (await me.json()) as { customer?: { name: string; email: string } };
          setCustomer(json.customer ?? null);
        } else {
          setCustomer(null);
        }
      } catch {
        setCustomer(null);
      }
    }
    load();

    // O carrinho e a sessão podem mudar em outra tela. Recarrega ao voltar para esta aba.
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  useEffect(() => {
    async function loadSettings() {
      try {
        const res = await fetch(`${API_URL}/api/store/settings`, { cache: "no-store" });
        const json = (await res.json().catch(() => ({}))) as { free_shipping_from_cents?: number; pix_discount_percent?: number; installments?: number };
        setSettings({ free_shipping_from_cents: json.free_shipping_from_cents ?? 0, pix_discount_percent: json.pix_discount_percent ?? 0, installments: json.installments ?? 1 });
      } catch {
        /* offline */
      }
    }
    loadSettings();
  }, []);

  // Sugestões de busca: debounce de 220 ms contra a API.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setSuggestions(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${API_URL}/api/store/search/suggestions?q=${encodeURIComponent(term)}`);
        if (res.ok) setSuggestions((await res.json()) as StoreSuggestion);
      } catch {
        setSuggestions(null);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setSuggestions(null);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const term = q.trim();
    if (!term) return;
    setSuggestions(null);
    router.push(`/busca?q=${encodeURIComponent(term)}`);
  }

  return (
    <header className={`site-header ${scrolled ? "is-scrolled" : ""}`}>
      <div className="header-topbar">
        <div className="header-topbar__inner">
          <span className="header-topbar__item">
            <span className="dot-live" /> Entrega para todo o Brasil
          </span>
          {/* Condições só com número real do banco — sem fallback inventado
              (o site antigo exibia R$700 numa página e R$699 noutra). */}
          {settings && settings.free_shipping_from_cents > 0 && (
            <span className="header-topbar__item">
              Frete grátis acima de {formatBRL(settings.free_shipping_from_cents)}
            </span>
          )}
          {settings && settings.pix_discount_percent > 0 && (
            <span className="header-topbar__item header-topbar__item--accent">
              PIX −{settings.pix_discount_percent}% na hora
            </span>
          )}
          {settings && settings.installments > 1 && (
            <span className="header-topbar__item">{settings.installments}x sem juros</span>
          )}
          <span className="header-topbar__spacer" />
          <Link href="/rastreamento" className="header-topbar__link">
            Rastrear pedido
          </Link>
          <Link href="/atendimento" className="header-topbar__link">
            Atendimento
          </Link>
          <Link href="/institucional" className="header-topbar__link">
            A loja
          </Link>
        </div>
      </div>

      <div className="header-main">
        <Link href="/" className="brand" aria-label="Airsoft Americana — página inicial">
          <Image src="/logo.png" alt="Airsoft Americana" width={56} height={56} className="brand__logo" priority />
          <span className="brand__text">
            <span className="brand__name">
              AIRSOFT <span className="brand__accent">AMERICANA</span>
            </span>
            <span className="brand__tag">Airsoft · Tiro Esportivo · Loadout</span>
          </span>
        </Link>

        <div className="header-search" ref={boxRef}>
          <form onSubmit={submit} role="search">
            <Search size={18} className="header-search__icon" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Busque por rifle AEG, colete, red dot…"
              aria-label="Buscar produtos"
              className="header-search__input"
            />
            <button type="submit" className="header-search__go">
              Buscar
            </button>
          </form>

          {suggestions && (
            <div className="suggest">
              {suggestions.products.length > 0 && (
                <div className="suggest__group">
                  <span className="suggest__title">Produtos</span>
                  {suggestions.products.map((p) => (
                    <Link
                      key={p.id}
                      href={`/${p.slug}`}
                      className="suggest__row"
                      onClick={() => setSuggestions(null)}
                    >
                      {p.imageUrl ? (
                        <Image src={p.imageUrl} alt="" width={40} height={40} className="suggest__thumb" />
                      ) : (
                        <span className="suggest__thumb suggest__thumb--empty" />
                      )}
                      <span className="suggest__label">{p.name}</span>
                    </Link>
                  ))}
                </div>
              )}
              {suggestions.categories.length > 0 && (
                <div className="suggest__group">
                  <span className="suggest__title">Categorias</span>
                  <div className="suggest__chips">
                    {suggestions.categories.map((c) => (
                      <Link
                        key={c.id}
                        href={`/catalogo?categoria=${c.slug}`}
                        className="suggest__chip"
                        onClick={() => setSuggestions(null)}
                      >
                        {c.name}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
              {suggestions.brands.length > 0 && (
                <div className="suggest__group">
                  <span className="suggest__title">Marcas</span>
                  <div className="suggest__chips">
                    {suggestions.brands.map((b) => (
                      <Link
                        key={b.id}
                        href={`/marca/${b.slug}`}
                        className="suggest__chip"
                        onClick={() => setSuggestions(null)}
                      >
                        {b.name}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <nav className="header-actions" aria-label="Conta e carrinho">
          {customer ? (
            <Link href="/conta" className="header-action header-action--account">
              <User size={20} />
              <span className="header-action__label">{customer.name.split(" ")[0]}</span>
            </Link>
          ) : (
            <Link href="/entrar" className="header-action">
              <User size={20} />
              <span className="header-action__label">Entrar</span>
            </Link>
          )}
          <Link href="/cart" className="header-action">
            <span className="header-action__cart">
              <ShoppingCart size={20} />
              {count > 0 && <span className="cart-badge">{count}</span>}
            </span>
            <span className="header-action__label">Carrinho</span>
          </Link>
        </nav>

        <button
          type="button"
          className="header-burger"
          aria-expanded={menuOpen}
          aria-label="Abrir menu"
          onClick={() => setMenuOpen((v) => !v)}
        >
          {menuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {menuOpen && (
        <nav className="header-mobile" aria-label="Menu principal">
          <Link href="/catalogo" onClick={() => setMenuOpen(false)}>
            Catálogo completo
          </Link>
          <Link href="/conta" onClick={() => setMenuOpen(false)}>
            Minha conta
          </Link>
          <Link href="/rastreamento" onClick={() => setMenuOpen(false)}>
            Acompanhar pedido
          </Link>
          <Link href="/atendimento" onClick={() => setMenuOpen(false)}>
            Atendimento
          </Link>
          <Link href="/institucional" onClick={() => setMenuOpen(false)}>
            A loja
          </Link>
          <Link href="/cart" onClick={() => setMenuOpen(false)}>
            Carrinho
          </Link>
        </nav>
      )}
    </header>
  );
}

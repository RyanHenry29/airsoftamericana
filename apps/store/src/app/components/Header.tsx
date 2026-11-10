// language: TSX, file: apps/store/src/app/components/Header.tsx, target: Next.js App Router
// Cabeçalho comercial: barra de condições, busca com sugestão, ícones e menu de departamentos.
"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Menu, Search, ShoppingCart, User, X } from "lucide-react";
import {
  API_URL,
  fetchWithTimeout,
  type StoreDepartment,
  type StoreSuggestion,
} from "../lib/store";
import { DeptStrip } from "./DeptStrip";

export function Header({ departments = [] }: { departments?: StoreDepartment[] }) {
  const router = useRouter();
  const [scrolled, setScrolled] = useState(false);
  const [topbarVisible, setTopbarVisible] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [q, setQ] = useState("");
  const [suggestions, setSuggestions] = useState<StoreSuggestion | null>(null);
  const [count, setCount] = useState(0);
  const [customer, setCustomer] = useState<{ name: string; email: string } | null>(null);
  const [place, setPlace] = useState<string | null>(null);
  const [fallbackDepts, setFallbackDepts] = useState<StoreDepartment[]>([]);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Topbar: some ao rolar para fora do hero; volta só quando o hero reaparece.
  useEffect(() => {
    const hero = document.querySelector<HTMLElement>(".hero, .dept-hero, .inst-hero, .auth-hero");
    if (!hero) {
      const onTop = () => setTopbarVisible(window.scrollY < 60);
      onTop();
      window.addEventListener("scroll", onTop, { passive: true });
      return () => window.removeEventListener("scroll", onTop);
    }
    const io = new IntersectionObserver(
      (entries) => setTopbarVisible(Boolean(entries[0]?.isIntersecting)),
      { threshold: 0.08 }
    );
    io.observe(hero);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetchWithTimeout(`${API_URL}/api/cart`, {
          credentials: "include",
        });
        const json = (await res.json().catch(() => ({}))) as { items?: { quantity: number }[] };
        setCount((json.items ?? []).reduce((a, i) => a + i.quantity, 0));
      } catch {
        /* offline */
      }
      try {
        const me = await fetchWithTimeout(`${API_URL}/api/auth/me`, {
          credentials: "include",
        });
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

  // Loja física da topbar: cidade/UF vêm das configurações do backend.
  // Páginas sem departamentos no SSR (carrinho, checkout, conta, institucionais)
  // buscam a árvore aqui — a barra nunca fica sem as entradas.
  useEffect(() => {
    let alive = true;
    fetchWithTimeout(`${API_URL}/api/store/settings`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        const address = (json as { address?: { city?: string; state?: string } } | null)?.address;
        if (alive && address?.city) {
          setPlace(`Loja física · ${address.city}${address.state ? `/${address.state}` : ""}`);
        }
      })
      .catch(() => {});
    if (departments.length === 0) {
      fetchWithTimeout(`${API_URL}/api/store/home`)
        .then((r) => (r.ok ? r.json() : null))
        .then((json) => {
          const depts = (json as { departments?: StoreDepartment[] } | null)?.departments;
          if (alive && depts && depts.length > 0) setFallbackDepts(depts);
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
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
        const res = await fetchWithTimeout(
          `${API_URL}/api/store/search/suggestions?q=${encodeURIComponent(term)}`,
        );
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
    <header className={`site-header ${scrolled ? "is-scrolled" : ""} ${topbarVisible ? "" : "is-topbar-hidden"}`}>
      {/* Topbar: promessa à esquerda, atalhos à direita (mesma leitura da referência). */}
      <div className="header-topbar" aria-hidden={!topbarVisible}>
        <div className="header-topbar__inner">
          <span className="header-topbar__item">
            <span className="dot-live" aria-hidden /> Entrega para todo o Brasil
          </span>
          <span className="header-topbar__spacer" />
          <span className="header-topbar__group header-topbar__group--info">
            <Link href="/rastreamento" className="header-topbar__link">
              Rastrear pedido
            </Link>
            {place && (
              <Link href="/institucional" className="header-topbar__link">
                {place}
              </Link>
            )}
            <Link href="/atendimento" className="header-topbar__link">
              Atendimento
            </Link>
          </span>
        </div>
      </div>

      <div className="header-main">
        <Link href="/" className="brand" aria-label="Airsoft Americana — página inicial">
          <Image src="/logo.png" alt="Airsoft Americana" width={84} height={84} className="brand__logo" priority quality={90} />
          <span className="brand__text">
            <span className="brand__name">
              AIRSOFT <span className="brand__accent">AMERICANA</span>
            </span>
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
            <Link href="/entrar" className="header-action header-action--account">
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

      <DeptStrip departments={departments.length > 0 ? departments : fallbackDepts} />

      {menuOpen && (
        <nav className="header-mobile" aria-label="Menu principal">
          {(departments.length > 0 ? departments : fallbackDepts).length > 0 && (
            <div className="header-mobile__group">
              <span className="header-mobile__label">Departamentos</span>
              {(departments.length > 0 ? departments : fallbackDepts).map((d) => (
                <Link key={d.id} href={`/departamento/${d.slug}`} onClick={() => setMenuOpen(false)}>
                  {d.name}
                </Link>
              ))}
            </div>
          )}
          <div className="header-mobile__group">
            <span className="header-mobile__label">A loja</span>
            <Link href="/catalogo" onClick={() => setMenuOpen(false)}>
              Catálogo completo
            </Link>
            <Link href="/guia" onClick={() => setMenuOpen(false)}>
              Guias
            </Link>
            <Link href="/blog" onClick={() => setMenuOpen(false)}>
              Blog
            </Link>
            <Link href="/por-que-comprar" onClick={() => setMenuOpen(false)}>
              Por que comprar aqui
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
          </div>
        </nav>
      )}
    </header>
  );
}

// language: TSX, file: apps/store/src/app/conta/ContaArea.tsx, target: Next.js App Router
// Minha conta: identidade, menu lateral e pedidos reais do cliente
// (GET /api/orders, escopo do próprio cliente). CPF/telefone formatados;
// status com o mesmo rótulo do rastreamento.
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  ClipboardList,
  Eye,
  Headset,
  IdCard,
  Lock,
  LogOut,
  MapPin,
  Package,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  ShieldCheck,
  ShoppingCart,
  Trash2,
  Truck,
} from "lucide-react";
import { API_URL, fetchWithTimeout } from "../lib/store";
import { OrderDetailModal } from "./OrderDetailModal";
import { PAY_LABEL, STATUS_LABEL, brl, dateBr } from "./order-labels";

type Customer = {
  id: string;
  name: string;
  email: string;
  cpf?: string | null;
  phone?: string | null;
  createdAt?: string | null;
};

type Order = {
  id: string;
  number: string;
  status: string;
  totalCents: number;
  paymentMethod: "pix" | "cartao" | "boleto" | null;
  createdAt: string;
};

type MenuLink = {
  kind: "link";
  label: string;
  href: string;
  icon: React.ElementType;
  active?: boolean;
};

type MenuAction = {
  kind: "action";
  label: string;
  action: "logout";
  icon: React.ElementType;
};

type MenuItem = MenuLink | MenuAction;

function menuFor(authed: boolean): MenuItem[] {
  const items: MenuItem[] = [
    { kind: "link", label: "Meus pedidos", href: "/conta", icon: ClipboardList, active: true },
    { kind: "link", label: "Rastrear pedido", href: "/rastreamento", icon: Truck },
    { kind: "link", label: "Atendimento", href: "/atendimento", icon: Headset },
  ];
  if (authed) items.push({ kind: "action", label: "Sair da conta", action: "logout", icon: LogOut });
  return items;
}

/** 000.000.000-00 — só formata quando o CPF tem os 11 dígitos. */
function formatCpf(value: string | null | undefined) {
  if (!value) return null;
  const d = value.replace(/\D/g, "").slice(0, 11);
  if (d.length !== 11) return value;
  return d.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
}

/** (00) 00000-0000 — fixo 10 dígitos, celular 11. */
function formatPhone(value: string | null | undefined) {
  if (!value) return null;
  const d = value.replace(/\D/g, "").slice(0, 11);
  if (d.length < 10) return value;
  if (d.length === 10) return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d)/, "$1-$2");
  return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");
}

/** Máscara progressiva do CPF durante a digitação (000.000.000-00). */
function maskCpf(value: string) {
  const d = value.replace(/\D/g, "").slice(0, 11);
  return d
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
}

/** Máscara progressiva do telefone ((00) 00000-0000 parcial enquanto digita). */
function maskPhone(value: string) {
  const d = value.replace(/\D/g, "").slice(0, 11);
  if (d.length === 0) return "";
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** CEP 00000-000 enquanto digita. */
function maskCep(value: string) {
  const d = value.replace(/\D/g, "").slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

type SavedAddress = {
  id: string;
  recipient: string;
  zip: string;
  street: string;
  number: string;
  complement: string | null;
  neighborhood: string;
  city: string;
  state: string;
  country: string;
  isDefault: boolean;
};

type ProfileForm = { name: string; cpf: string; phone: string };
type AddressForm = {
  recipient: string;
  zip: string;
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
  isDefault: boolean;
};

/** Validação do perfil — mesma régua do updateProfileSchema do servidor. */
function validateProfile(v: ProfileForm) {
  const errors: Partial<Record<keyof ProfileForm, string>> = {};
  const name = v.name.trim();
  if (name.length < 2) errors.name = "Coloque seu nome completo";
  else if (name.length > 120) errors.name = "Nome longo demais";
  const digits = v.cpf.replace(/\D/g, "");
  if (digits.length > 0 && digits.length !== 11) errors.cpf = "CPF deve conter 11 dígitos";
  if (v.phone.replace(/\D/g, "").length > 20) errors.phone = "Telefone longo demais";
  return errors;
}

/** Validação do endereço — mesma régua do savedAddressSchema do servidor. */
function validateAddress(v: AddressForm) {
  const errors: Partial<Record<keyof AddressForm, string>> = {};
  if (v.recipient.trim().length < 2) errors.recipient = "Informe quem recebe";
  if (v.zip.replace(/\D/g, "").length !== 8) errors.zip = "CEP deve conter 8 dígitos";
  if (v.street.trim().length < 3) errors.street = "Informe o logradouro";
  if (v.number.trim().length < 1) errors.number = "Informe o número";
  if (v.neighborhood.trim().length < 2) errors.neighborhood = "Informe o bairro";
  if (v.city.trim().length < 2) errors.city = "Informe a cidade";
  if (v.state.trim().length !== 2) errors.state = "Use a sigla (UF)";
  return errors;
}

/** Campo de formulário da conta: erro só após tocar no campo (validação reativa). */
function FormField(props: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  error?: string;
  touched?: boolean;
  inputMode?: "text" | "numeric" | "tel";
  autoComplete?: string;
  maxLength?: number;
  full?: boolean;
  placeholder?: string;
}) {
  const invalid = Boolean(props.touched && props.error);
  return (
    <div className={`conta-form-field ${props.full ? "conta-form-field--full" : ""}`}>
      <label className="conta-form-label" htmlFor={props.id}>
        {props.label}
      </label>
      <input
        id={props.id}
        className="conta-input"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        onBlur={props.onBlur}
        inputMode={props.inputMode}
        autoComplete={props.autoComplete}
        maxLength={props.maxLength}
        placeholder={props.placeholder}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${props.id}-err` : undefined}
      />
      {invalid && (
        <span className="conta-err" id={`${props.id}-err`}>
          {props.error}
        </span>
      )}
    </div>
  );
}

export function ContaArea() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [modal, setModal] = useState<{ number: string; mode: "espiar" | "comprar" } | null>(null);

  // Perfil editável
  const [profileEdit, setProfileEdit] = useState(false);
  const [pf, setPf] = useState<ProfileForm>({ name: "", cpf: "", phone: "" });
  const [pfErrors, setPfErrors] = useState<Partial<Record<keyof ProfileForm, string>>>({});
  const [pfTouched, setPfTouched] = useState<Partial<Record<keyof ProfileForm, boolean>>>({});
  const [pfBusy, setPfBusy] = useState(false);
  const [pfMsg, setPfMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Endereços salvos
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [addrLoading, setAddrLoading] = useState(true);
  const [addrFormOpen, setAddrFormOpen] = useState(false);
  const [addrEditId, setAddrEditId] = useState<string | null>(null);
  const [af, setAf] = useState<AddressForm>({
    recipient: "",
    zip: "",
    street: "",
    number: "",
    complement: "",
    neighborhood: "",
    city: "",
    state: "",
    isDefault: false,
  });
  const [afErrors, setAfErrors] = useState<Partial<Record<keyof AddressForm, string>>>({});
  const [afTouched, setAfTouched] = useState<Partial<Record<keyof AddressForm, boolean>>>({});
  const [afBusy, setAfBusy] = useState(false);
  const [afMsg, setAfMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  async function loadAddresses() {
    setAddrLoading(true);
    try {
      const res = await fetchWithTimeout(`${API_URL}/api/customer/addresses`, { credentials: "include" });
      const json = (await res.json().catch(() => ({}))) as { items?: SavedAddress[] };
      if (res.ok) setAddresses(json.items ?? []);
    } catch {
      /* endereços fora do ar não derrubam a conta */
    } finally {
      setAddrLoading(false);
    }
  }

  async function load() {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetchWithTimeout(`${API_URL}/api/auth/me`, { credentials: "include" });
      const json = (await res.json().catch(() => ({}))) as { customer?: Customer };
      if (res.ok && json.customer) {
        setCustomer(json.customer);
        try {
          const ord = await fetchWithTimeout(`${API_URL}/api/orders`, { credentials: "include" });
          const data = (await ord.json().catch(() => ({}))) as { items?: Order[] };
          if (ord.ok) setOrders(data.items ?? []);
        } catch {
          /* pedidos fora do ar não derrubam a conta */
        }
        await loadAddresses();
      } else if (res.status !== 401) {
        // 401 = deslogado (estado vazio legítimo); o resto é falha de carga.
        setLoadError(true);
      }
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function logout() {
    await fetch(`${API_URL}/api/auth/logout`, { method: "POST", credentials: "include" }).catch(() => {});
    router.push("/");
    router.refresh();
  }

  function startProfileEdit() {
    if (!customer) return;
    setPf({ name: customer.name, cpf: formatCpf(customer.cpf) ?? "", phone: formatPhone(customer.phone) ?? "" });
    setPfErrors({});
    setPfTouched({});
    setPfMsg(null);
    setProfileEdit(true);
  }

  function onPfChange(key: keyof ProfileForm, value: string) {
    const masked = key === "cpf" ? maskCpf(value) : key === "phone" ? maskPhone(value) : value;
    const next = { ...pf, [key]: masked };
    setPf(next);
    // erro some sozinho quando o campo volta a ficar válido
    if (pfTouched[key]) setPfErrors(validateProfile(next));
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setPfTouched({ name: true, cpf: true, phone: true });
    const errors = validateProfile(pf);
    setPfErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setPfBusy(true);
    setPfMsg(null);
    try {
      const res = await fetchWithTimeout(`${API_URL}/api/auth/me`, {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: pf.name.trim(),
          cpf: pf.cpf.replace(/\D/g, ""),
          phone: pf.phone,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { customer?: Customer; error?: { message?: string } };
      if (res.ok && json.customer) {
        setCustomer(json.customer);
        setProfileEdit(false);
        setPfMsg({ ok: true, text: "Dados atualizados — valem já no checkout." });
      } else {
        setPfMsg({ ok: false, text: json.error?.message ?? "Não foi possível salvar. Tente de novo." });
      }
    } catch {
      setPfMsg({ ok: false, text: "Sem conexão com a loja — tente de novo." });
    } finally {
      setPfBusy(false);
    }
  }

  function startAddressForm(address?: SavedAddress) {
    setAfMsg(null);
    setAfErrors({});
    setAfTouched({});
    if (address) {
      setAddrEditId(address.id);
      setAf({
        recipient: address.recipient,
        zip: maskCep(address.zip),
        street: address.street,
        number: address.number,
        complement: address.complement ?? "",
        neighborhood: address.neighborhood,
        city: address.city,
        state: address.state,
        isDefault: address.isDefault,
      });
    } else {
      setAddrEditId(null);
      setAf({
        recipient: customer?.name ?? "",
        zip: "",
        street: "",
        number: "",
        complement: "",
        neighborhood: "",
        city: "",
        state: "",
        isDefault: addresses.length === 0,
      });
    }
    setAddrFormOpen(true);
  }

  function onAfChange(key: keyof AddressForm, value: string | boolean) {
    let masked: string | boolean = value;
    if (key === "zip" && typeof value === "string") masked = maskCep(value);
    if (key === "state" && typeof value === "string") masked = value.toUpperCase().slice(0, 2);
    const next = { ...af, [key]: masked } as AddressForm;
    setAf(next);
    if (afTouched[key]) setAfErrors(validateAddress(next));
  }

  async function saveAddress(e: React.FormEvent) {
    e.preventDefault();
    setAfTouched({ recipient: true, zip: true, street: true, number: true, neighborhood: true, city: true, state: true });
    const errors = validateAddress(af);
    setAfErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setAfBusy(true);
    setAfMsg(null);
    const payload = {
      recipient: af.recipient.trim(),
      zip: af.zip.replace(/\D/g, ""),
      street: af.street.trim(),
      number: af.number.trim(),
      complement: af.complement.trim(),
      neighborhood: af.neighborhood.trim(),
      city: af.city.trim(),
      state: af.state.trim(),
      isDefault: af.isDefault,
    };
    try {
      const url = addrEditId
        ? `${API_URL}/api/customer/addresses/${encodeURIComponent(addrEditId)}`
        : `${API_URL}/api/customer/addresses`;
      const res = await fetchWithTimeout(url, {
        method: addrEditId ? "PUT" : "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (res.ok) {
        setAddrFormOpen(false);
        setAddrEditId(null);
        await loadAddresses();
        setAfMsg({ ok: true, text: addrEditId ? "Endereço atualizado." : "Endereço salvo." });
      } else {
        setAfMsg({ ok: false, text: json.error?.message ?? "Não foi possível salvar o endereço." });
      }
    } catch {
      setAfMsg({ ok: false, text: "Sem conexão com a loja — tente de novo." });
    } finally {
      setAfBusy(false);
    }
  }

  async function makeDefault(address: SavedAddress) {
    setAfMsg(null);
    try {
      const res = await fetchWithTimeout(`${API_URL}/api/customer/addresses/${encodeURIComponent(address.id)}`, {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          recipient: address.recipient,
          zip: address.zip,
          street: address.street,
          number: address.number,
          complement: address.complement ?? "",
          neighborhood: address.neighborhood,
          city: address.city,
          state: address.state,
          country: address.country,
          isDefault: true,
        }),
      });
      if (res.ok) {
        await loadAddresses();
        setAfMsg({ ok: true, text: "Endereço padrão de entrega alterado." });
      } else {
        const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        setAfMsg({ ok: false, text: json.error?.message ?? "Não foi possível alterar o padrão." });
      }
    } catch {
      setAfMsg({ ok: false, text: "Sem conexão com a loja — tente de novo." });
    }
  }

  async function deleteAddress(address: SavedAddress) {
    if (confirmDeleteId !== address.id) {
      setConfirmDeleteId(address.id);
      return;
    }
    setConfirmDeleteId(null);
    setAfMsg(null);
    try {
      const res = await fetchWithTimeout(`${API_URL}/api/customer/addresses/${encodeURIComponent(address.id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        await loadAddresses();
        setAfMsg({ ok: true, text: "Endereço removido." });
      } else {
        const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        setAfMsg({ ok: false, text: json.error?.message ?? "Não foi possível remover o endereço." });
      }
    } catch {
      setAfMsg({ ok: false, text: "Sem conexão com a loja — tente de novo." });
    }
  }

  if (loading) {
    return (
      <div className="conta-shell">
        <div className="conta-header">
          <div className="conta-avatar">?</div>
          <div className="conta-ident">
            <p className="conta-kicker">MINHA CONTA</p>
            <h1 className="conta-name conta-name--skeleton">Carregando…</h1>
          </div>
        </div>
        <div className="conta-body">
          <aside className="conta-sidebar">
            {menuFor(false).map((m) => (
              <span key={m.label} className="conta-menu-item conta-menu-item--skeleton">
                <span className="conta-menu-icon" aria-hidden="true" />
                <span className="conta-menu-label">—</span>
              </span>
            ))}
          </aside>
          <main className="conta-main">
            <div className="conta-card conta-card--skeleton" />
            <div className="conta-card conta-card--skeleton" />
          </main>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="conta-shell">
        <div className="conta-header">
          <div className="conta-avatar" aria-hidden="true">!</div>
          <div className="conta-ident">
            <p className="conta-kicker">MINHA CONTA</p>
            <h1 className="conta-name">Falha ao carregar</h1>
          </div>
        </div>
        <div className="conta-body">
          <aside className="conta-sidebar">
            {menuFor(false).map((m) =>
              m.kind === "link" ? (
                <Link key={m.href} href={m.href} className="conta-menu-item conta-menu-item--off">
                  <m.icon size={16} strokeWidth={2} className="conta-menu-icon" aria-hidden="true" />
                  <span className="conta-menu-label">{m.label}</span>
                </Link>
              ) : null
            )}
          </aside>
          <main className="conta-main">
            <div className="conta-empty" role="alert">
              <span className="conta-empty-icon" aria-hidden="true">
                <AlertTriangle size={26} strokeWidth={1.6} />
              </span>
              <h2 className="conta-empty-title">Não conseguimos carregar sua conta</h2>
              <p className="conta-empty-text">
                A conexão com a loja falhou. Nada do seu histórico se perdeu — tente de novo.
              </p>
              <div className="conta-empty-actions">
                <button type="button" className="btn-primary" onClick={() => load()}>
                  <RefreshCw size={15} strokeWidth={2} aria-hidden="true" />
                  Tentar novamente
                </button>
              </div>
            </div>
          </main>
        </div>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="conta-shell">
        <div className="conta-header">
          <div className="conta-avatar">?</div>
          <div className="conta-ident">
            <p className="conta-kicker">MINHA CONTA</p>
            <h1 className="conta-name">Você ainda não entrou</h1>
          </div>
        </div>
        <div className="conta-body">
          <aside className="conta-sidebar">
            {menuFor(false).map((m) =>
              m.kind === "link" ? (
                <Link key={m.href} href={m.href} className="conta-menu-item conta-menu-item--off">
                  <m.icon size={16} strokeWidth={2} className="conta-menu-icon" aria-hidden="true" />
                  <span className="conta-menu-label">{m.label}</span>
                </Link>
              ) : null
            )}
          </aside>
          <main className="conta-main">
            <div className="conta-empty">
              <span className="conta-empty-icon" aria-hidden="true">
                <Lock size={26} strokeWidth={1.6} />
              </span>
              <h2 className="conta-empty-title">Entre com sua conta</h2>
              <p className="conta-empty-text">
                Veja seus pedidos, acompanhe a entrega e compre mais rápido.
              </p>
              <div className="conta-empty-actions">
                <Link href="/entrar" className="btn-primary">
                  Entrar
                </Link>
                <Link href="/cadastro" className="btn-ghost">
                  Criar conta
                </Link>
              </div>
            </div>
          </main>
        </div>
      </div>
    );
  }

  const initials = customer.name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  const cpf = formatCpf(customer.cpf);
  const phone = formatPhone(customer.phone);

  return (
    <div className="conta-shell">
      <div className="conta-header">
        <div className="conta-avatar" aria-hidden="true">{initials}</div>
        <div className="conta-ident">
          <p className="conta-kicker">MINHA CONTA</p>
          <h1 className="conta-name">{customer.name}</h1>
          <p className="conta-meta">
            {customer.email}
            {customer.createdAt && <> · cliente desde {dateBr(customer.createdAt)}</>}
          </p>
        </div>
      </div>

      <div className="conta-body">
        <aside className="conta-sidebar" aria-label="Menu da conta">
          {menuFor(true).map((m) => {
            const Icon = m.icon;
            if (m.kind === "action" && m.action === "logout") {
              return (
                <button key={m.label} type="button" onClick={logout} className="conta-menu-item conta-menu-item--action">
                  <Icon size={16} strokeWidth={2} className="conta-menu-icon" aria-hidden="true" />
                  <span className="conta-menu-label">{m.label}</span>
                </button>
              );
            }
            if (m.kind === "link") {
              return (
                <Link
                  key={m.href}
                  href={m.href}
                  className={`conta-menu-item ${m.active ? "conta-menu-item--active" : ""}`}
                  aria-current={m.active ? "page" : undefined}
                >
                  <Icon size={16} strokeWidth={2} className="conta-menu-icon" aria-hidden="true" />
                  <span className="conta-menu-label">{m.label}</span>
                </Link>
              );
            }
            return null;
          })}
        </aside>

        <main className="conta-main">
          <section className="conta-card" aria-labelledby="pedidos-title">
            <div className="conta-card-head">
              <div>
                <span className="conta-card-kicker" id="pedidos-title">MEUS PEDIDOS</span>
                <p className="conta-card-sub">
                  {orders.length > 0
                    ? `${orders.length} ${orders.length === 1 ? "pedido" : "pedidos"} na sua conta`
                    : "Seus pedidos aparecem aqui assim que você comprar"}
                </p>
              </div>
              <Link href="/rastreamento" className="conta-card-link">
                Acompanhar pedido <ArrowRight size={14} strokeWidth={2} aria-hidden="true" />
              </Link>
            </div>

            {orders.length === 0 ? (
              <div className="conta-empty">
                <span className="conta-empty-icon" aria-hidden="true">
                  <Package size={26} strokeWidth={1.6} />
                </span>
                <h2 className="conta-empty-title">Você ainda não fez nenhum pedido.</h2>
                <p className="conta-empty-text">Quando você comprar, o pedido e o rastreio ficam aqui.</p>
                <div className="conta-empty-actions">
                  <Link href="/catalogo" className="btn-primary">
                    Ir para a loja
                  </Link>
                </div>
              </div>
            ) : (
              <ol className="conta-orders">
                {orders.map((o) => (
                  <li key={o.id} className="conta-order">
                    <div className="conta-order__id">
                      <strong>Pedido {o.number}</strong>
                      <span>{dateBr(o.createdAt)}</span>
                    </div>
                    <span className="conta-order__status" data-status={o.status}>
                      {STATUS_LABEL[o.status] ?? o.status}
                    </span>
                    <span className="conta-order__pay">{o.paymentMethod ? (PAY_LABEL[o.paymentMethod] ?? "—") : "—"}</span>
                    <span className="conta-order__total">{brl(o.totalCents)}</span>
                    <div className="conta-order__actions">
                      <button
                        type="button"
                        className="conta-order__btn"
                        onClick={() => setModal({ number: o.number, mode: "espiar" })}
                      >
                        <Eye size={13} strokeWidth={2} aria-hidden="true" /> ESPIAR
                      </button>
                      <button
                        type="button"
                        className="conta-order__btn conta-order__btn--buy"
                        onClick={() => setModal({ number: o.number, mode: "comprar" })}
                      >
                        <ShoppingCart size={13} strokeWidth={2} aria-hidden="true" /> COMPRAR
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="conta-card conta-card--data" aria-labelledby="dados-title">
            <div className="conta-card-head">
              <div>
                <span className="conta-card-kicker conta-card-kicker--secure" id="dados-title">
                  <ShieldCheck size={14} strokeWidth={2} aria-hidden="true" />
                  DADOS DA CONTA
                </span>
                <p className="conta-card-sub">Informações do seu cadastro na loja</p>
              </div>
              {!profileEdit && (
                <button type="button" className="conta-head-action" onClick={startProfileEdit}>
                  <Pencil size={13} strokeWidth={2} aria-hidden="true" /> Editar dados
                </button>
              )}
            </div>

            {pfMsg && (
              <p className={`conta-msg ${pfMsg.ok ? "conta-msg--ok" : "conta-msg--err"}`} role="status">
                {pfMsg.text}
              </p>
            )}

            {!profileEdit ? (
              <div className="conta-grid">
                <div className="conta-field">
                  <span className="conta-field-label">
                    <IdCard size={13} strokeWidth={2} aria-hidden="true" /> E-mail
                  </span>
                  <p className="conta-field-value">{customer.email}</p>
                </div>
                <div className="conta-field">
                  <span className="conta-field-label">
                    <IdCard size={13} strokeWidth={2} aria-hidden="true" /> CPF
                  </span>
                  <p className="conta-field-value">{cpf ?? "—"}</p>
                </div>
                <div className="conta-field">
                  <span className="conta-field-label">
                    <Phone size={13} strokeWidth={2} aria-hidden="true" /> Telefone
                  </span>
                  <p className="conta-field-value">{phone ?? "—"}</p>
                </div>
                <div className="conta-field">
                  <span className="conta-field-label">
                    <ShieldCheck size={13} strokeWidth={2} aria-hidden="true" /> Cadastro
                  </span>
                  <p className="conta-field-value">
                    {customer.createdAt ? dateBr(customer.createdAt) : "—"}
                  </p>
                </div>
              </div>
            ) : (
              <form className="conta-form" onSubmit={saveProfile} noValidate>
                <FormField
                  id="pf-name"
                  label="Nome completo"
                  value={pf.name}
                  onChange={(v) => onPfChange("name", v)}
                  onBlur={() => {
                    setPfTouched((t) => ({ ...t, name: true }));
                    setPfErrors(validateProfile(pf));
                  }}
                  error={pfErrors.name}
                  touched={pfTouched.name}
                  autoComplete="name"
                  maxLength={120}
                  full
                />
                <FormField
                  id="pf-cpf"
                  label="CPF"
                  value={pf.cpf}
                  onChange={(v) => onPfChange("cpf", v)}
                  onBlur={() => {
                    setPfTouched((t) => ({ ...t, cpf: true }));
                    setPfErrors(validateProfile(pf));
                  }}
                  error={pfErrors.cpf}
                  touched={pfTouched.cpf}
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={14}
                  placeholder="000.000.000-00"
                />
                <FormField
                  id="pf-phone"
                  label="Telefone / WhatsApp"
                  value={pf.phone}
                  onChange={(v) => onPfChange("phone", v)}
                  onBlur={() => {
                    setPfTouched((t) => ({ ...t, phone: true }));
                    setPfErrors(validateProfile(pf));
                  }}
                  error={pfErrors.phone}
                  touched={pfTouched.phone}
                  inputMode="tel"
                  autoComplete="tel"
                  maxLength={15}
                  placeholder="(00) 00000-0000"
                />
                <div className="conta-form-actions">
                  <button
                    type="button"
                    className="conta-head-action"
                    onClick={() => setProfileEdit(false)}
                    disabled={pfBusy}
                  >
                    Cancelar
                  </button>
                  <button type="submit" className="btn-primary" disabled={pfBusy}>
                    {pfBusy ? "Salvando…" : "Salvar alterações"}
                  </button>
                </div>
              </form>
            )}
          </section>

          <section className="conta-card" aria-labelledby="enderecos-title">
            <div className="conta-card-head">
              <div>
                <span className="conta-card-kicker" id="enderecos-title">
                  <MapPin size={14} strokeWidth={2} aria-hidden="true" />
                  ENDEREÇOS DE ENTREGA
                </span>
                <p className="conta-card-sub">O endereço padrão vem preenchido no checkout</p>
              </div>
              {!addrFormOpen && (
                <button type="button" className="conta-head-action" onClick={() => startAddressForm()}>
                  <Plus size={13} strokeWidth={2} aria-hidden="true" />{" "}
                  {addresses.length > 0 ? "Novo endereço" : "Adicionar"}
                </button>
              )}
            </div>

            {afMsg && (
              <p className={`conta-msg ${afMsg.ok ? "conta-msg--ok" : "conta-msg--err"}`} role="status">
                {afMsg.text}
              </p>
            )}

            {addrFormOpen ? (
              <form className="conta-form" onSubmit={saveAddress} noValidate>
                <FormField
                  id="af-recipient"
                  label="Quem recebe"
                  value={af.recipient}
                  onChange={(v) => onAfChange("recipient", v)}
                  onBlur={() => {
                    setAfTouched((t) => ({ ...t, recipient: true }));
                    setAfErrors(validateAddress(af));
                  }}
                  error={afErrors.recipient}
                  touched={afTouched.recipient}
                  autoComplete="name"
                  maxLength={120}
                  full
                />
                <FormField
                  id="af-zip"
                  label="CEP"
                  value={af.zip}
                  onChange={(v) => onAfChange("zip", v)}
                  onBlur={() => {
                    setAfTouched((t) => ({ ...t, zip: true }));
                    setAfErrors(validateAddress(af));
                  }}
                  error={afErrors.zip}
                  touched={afTouched.zip}
                  inputMode="numeric"
                  autoComplete="postal-code"
                  maxLength={9}
                  placeholder="00000-000"
                />
                <FormField
                  id="af-number"
                  label="Número"
                  value={af.number}
                  onChange={(v) => onAfChange("number", v)}
                  onBlur={() => {
                    setAfTouched((t) => ({ ...t, number: true }));
                    setAfErrors(validateAddress(af));
                  }}
                  error={afErrors.number}
                  touched={afTouched.number}
                  inputMode="numeric"
                  autoComplete="address-line2"
                  maxLength={20}
                />
                <FormField
                  id="af-street"
                  label="Logradouro"
                  value={af.street}
                  onChange={(v) => onAfChange("street", v)}
                  onBlur={() => {
                    setAfTouched((t) => ({ ...t, street: true }));
                    setAfErrors(validateAddress(af));
                  }}
                  error={afErrors.street}
                  touched={afTouched.street}
                  autoComplete="address-line1"
                  maxLength={160}
                  placeholder="Rua, avenida…"
                  full
                />
                <FormField
                  id="af-complement"
                  label="Complemento"
                  value={af.complement}
                  onChange={(v) => onAfChange("complement", v)}
                  onBlur={() => setAfTouched((t) => ({ ...t, complement: true }))}
                  autoComplete="address-line3"
                  maxLength={120}
                  placeholder="apto, bloco…"
                />
                <FormField
                  id="af-neighborhood"
                  label="Bairro"
                  value={af.neighborhood}
                  onChange={(v) => onAfChange("neighborhood", v)}
                  onBlur={() => {
                    setAfTouched((t) => ({ ...t, neighborhood: true }));
                    setAfErrors(validateAddress(af));
                  }}
                  error={afErrors.neighborhood}
                  touched={afTouched.neighborhood}
                  autoComplete="address-level3"
                  maxLength={80}
                />
                <FormField
                  id="af-city"
                  label="Cidade"
                  value={af.city}
                  onChange={(v) => onAfChange("city", v)}
                  onBlur={() => {
                    setAfTouched((t) => ({ ...t, city: true }));
                    setAfErrors(validateAddress(af));
                  }}
                  error={afErrors.city}
                  touched={afTouched.city}
                  autoComplete="address-level2"
                  maxLength={80}
                />
                <FormField
                  id="af-state"
                  label="UF"
                  value={af.state}
                  onChange={(v) => onAfChange("state", v)}
                  onBlur={() => {
                    setAfTouched((t) => ({ ...t, state: true }));
                    setAfErrors(validateAddress(af));
                  }}
                  error={afErrors.state}
                  touched={afTouched.state}
                  autoComplete="address-level1"
                  maxLength={2}
                  placeholder="SP"
                />
                <label className="conta-check conta-form-field--full" htmlFor="af-default">
                  <input
                    id="af-default"
                    type="checkbox"
                    checked={af.isDefault}
                    onChange={(e) => onAfChange("isDefault", e.target.checked)}
                  />
                  Usar este endereço como padrão de entrega
                </label>
                <div className="conta-form-actions">
                  <button
                    type="button"
                    className="conta-head-action"
                    onClick={() => {
                      setAddrFormOpen(false);
                      setAddrEditId(null);
                    }}
                    disabled={afBusy}
                  >
                    Cancelar
                  </button>
                  <button type="submit" className="btn-primary" disabled={afBusy}>
                    {afBusy ? "Salvando…" : addrEditId ? "Salvar alterações" : "Salvar endereço"}
                  </button>
                </div>
              </form>
            ) : addrLoading ? (
              <div className="conta-addr-list" aria-busy="true">
                <div className="conta-card conta-card--skeleton" />
                <div className="conta-card conta-card--skeleton" />
              </div>
            ) : addresses.length === 0 ? (
              <div className="conta-empty">
                <span className="conta-empty-icon" aria-hidden="true">
                  <MapPin size={26} strokeWidth={1.6} />
                </span>
                <h2 className="conta-empty-title">Nenhum endereço salvo</h2>
                <p className="conta-card-sub">
                  Salve seu endereço uma vez — o checkout já vai preenchido.
                </p>
                <div className="conta-empty-actions">
                  <button type="button" className="btn-primary" onClick={() => startAddressForm()}>
                    Adicionar endereço
                  </button>
                </div>
              </div>
            ) : (
              <ul className="conta-addr-list">
                {addresses.map((a) => (
                  <li key={a.id} className={`conta-addr ${a.isDefault ? "conta-addr--default" : ""}`}>
                    <div className="conta-addr__body">
                      <div className="conta-addr__top">
                        <strong className="conta-addr__name">{a.recipient}</strong>
                        {a.isDefault && <span className="conta-addr__badge">PADRÃO</span>}
                      </div>
                      <p className="conta-addr__line">
                        {a.street}, {a.number}
                        {a.complement ? ` — ${a.complement}` : ""}
                      </p>
                      <p className="conta-addr__line">
                        {a.neighborhood} · {a.city}/{a.state} · CEP {maskCep(a.zip)}
                      </p>
                    </div>
                    <div className="conta-addr__actions">
                      {!a.isDefault && (
                        <button
                          type="button"
                          className="conta-order__btn conta-order__btn--buy"
                          onClick={() => makeDefault(a)}
                        >
                          USAR NO CHECKOUT
                        </button>
                      )}
                      <button type="button" className="conta-order__btn" onClick={() => startAddressForm(a)}>
                        <Pencil size={12} strokeWidth={2} aria-hidden="true" /> EDITAR
                      </button>
                      <button
                        type="button"
                        className={`conta-order__btn conta-order__btn--danger ${
                          confirmDeleteId === a.id ? "conta-order__btn--confirm" : ""
                        }`}
                        onClick={() => deleteAddress(a)}
                        aria-label={`Excluir endereço de ${a.recipient}`}
                      >
                        <Trash2 size={12} strokeWidth={2} aria-hidden="true" />{" "}
                        {confirmDeleteId === a.id ? "CONFIRMAR" : "EXCLUIR"}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </main>
      </div>

      {modal && (
        <OrderDetailModal
          orderNumber={modal.number}
          mode={modal.mode}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

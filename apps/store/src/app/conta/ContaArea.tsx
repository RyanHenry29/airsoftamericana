// language: TSX, file: apps/store/src/app/conta/ContaArea.tsx, target: Next.js App Router
// Minha conta: identidade, dados do cadastro e endereços salvos — o acesso
// "Meus pedidos" mora em /conta/pedidos (PedidosArea). CPF/telefone
// formatados; endereço com ViaCEP na hora de preencher.
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Camera,
  IdCard,
  MapPin,
  Pencil,
  Phone,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { API_URL, fetchWithTimeout } from "../lib/store";
import { fetchViaCep, formatCep as maskCep, isCompleteCep, mergeCepLookup } from "../lib/viacep";
import { fileToAvatarDataUrl, isAvatarSource } from "../lib/avatar";
import { AvatarFace, ContaShell } from "./ContaShell";
import { initialsOf, logoutAccount, type Customer } from "./conta-menu";
import { dateBr } from "./order-labels";

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
  hint?: React.ReactNode;
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
      {invalid ? (
        <span className="conta-err" id={`${props.id}-err`}>
          {props.error}
        </span>
      ) : (
        props.hint && (
          <span className="conta-hint" id={`${props.id}-hint`}>
            {props.hint}
          </span>
        )
      )}
    </div>
  );
}

export function ContaArea() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [customer, setCustomer] = useState<Customer | null>(null);
  // Perfil editável
  const [profileEdit, setProfileEdit] = useState(false);
  const [pf, setPf] = useState<ProfileForm>({ name: "", cpf: "", phone: "" });
  const [pfErrors, setPfErrors] = useState<Partial<Record<keyof ProfileForm, string>>>({});
  const [pfTouched, setPfTouched] = useState<Partial<Record<keyof ProfileForm, boolean>>>({});
  const [pfBusy, setPfBusy] = useState(false);
  const [pfMsg, setPfMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Foto de perfil: `avatarVersion` recarrega a imagem do cabeçalho e da
  // ficha; `hasAvatar` habilita o botão de remover.
  const [avatarVersion, setAvatarVersion] = useState(0);
  const [hasAvatar, setHasAvatar] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoMsg, setPhotoMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Endereços salvos
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [addrLoading, setAddrLoading] = useState(true);
  const [addrFormOpen, setAddrFormOpen] = useState(false);
  const [addrEditId, setAddrEditId] = useState<string | null>(null);
  // Consulta ViaCEP: rua/bairro/cidade/uf vêm da base, número e complemento
  // são do cliente. `afCepDone` evita repetir a mesma consulta no mesmo CEP.
  const [afCepStatus, setAfCepStatus] = useState<"idle" | "busy" | "ok" | "miss">("idle");
  const afCepDone = useRef("");
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
          // prova se existe foto (200/404) — só pra habilitar o "Remover"
          const av = await fetchWithTimeout(`${API_URL}/api/customer/avatar`, { credentials: "include" });
          setHasAvatar(av.ok);
        } catch {
          setHasAvatar(false);
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
    await logoutAccount(router);
  }

  /** Escolhe a imagem, reduz pra 512px no canvas e envia (o servidor valida). */
  async function onPhotoPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // deixa escolher o mesmo arquivo de novo
    if (!file || photoBusy) return;
    if (!isAvatarSource(file)) {
      setPhotoMsg({ ok: false, text: "Escolha uma imagem JPG, PNG ou WebP de até 12 MB." });
      return;
    }
    setPhotoBusy(true);
    setPhotoMsg(null);
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      const res = await fetchWithTimeout(`${API_URL}/api/customer/avatar`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image: dataUrl }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (res.ok) {
        setHasAvatar(true);
        setAvatarVersion((v) => v + 1);
        setPhotoMsg({ ok: true, text: "Foto atualizada — vale no cabeçalho da conta." });
      } else {
        setPhotoMsg({ ok: false, text: json.error?.message ?? "Não foi possível enviar a foto. Tente de novo." });
      }
    } catch {
      setPhotoMsg({ ok: false, text: "Sem conexão com a loja — tente de novo." });
    } finally {
      setPhotoBusy(false);
    }
  }

  async function removePhoto() {
    if (photoBusy) return;
    setPhotoBusy(true);
    setPhotoMsg(null);
    try {
      const res = await fetchWithTimeout(`${API_URL}/api/customer/avatar`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        setHasAvatar(false);
        setAvatarVersion((v) => v + 1);
        setPhotoMsg({ ok: true, text: "Foto removida — suas iniciais voltam pro lugar." });
      } else {
        setPhotoMsg({ ok: false, text: "Não foi possível remover a foto. Tente de novo." });
      }
    } catch {
      setPhotoMsg({ ok: false, text: "Sem conexão com a loja — tente de novo." });
    } finally {
      setPhotoBusy(false);
    }
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
    afCepDone.current = "";
    setAfCepStatus("idle");
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
    if (key === "zip" && typeof value === "string") {
      masked = maskCep(value);
      if (isCompleteCep(String(masked))) void lookupAfCep(String(masked));
    }
    if (key === "state" && typeof value === "string") masked = value.toUpperCase().slice(0, 2);
    const next = { ...af, [key]: masked } as AddressForm;
    setAf(next);
    if (afTouched[key]) setAfErrors(validateAddress(next));
  }

  /** Preenche rua/bairro/cidade/uf no form. Falha (rede, CEP inexistente) = null silencioso. */
  async function lookupAfCep(cepValue: string) {
    const digits = cepValue.replace(/\D/g, "");
    if (digits.length !== 8 || afCepDone.current === digits) return;
    afCepDone.current = digits;
    setAfCepStatus("busy");
    const found = await fetchViaCep(digits);
    if (!found) {
      setAfCepStatus("miss");
      return;
    }
    setAf((cur) => mergeCepLookup(cur, found));
    setAfCepStatus("ok");
  }

  // O ViaCEP responde depois do blur: sem isso o "Informe o logradouro"
  // levantado na validação anterior ficaria preso mesmo com o campo preenchido.
  useEffect(() => {
    if (Object.keys(afTouched).length > 0) setAfErrors(validateAddress(af));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [af]);

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

  // Carga, falha e deslogado são estados do casco; daqui pra baixo o cliente
  // existe e as seções podem usá-lo com segurança de tipo.
  if (loading || loadError || !customer) {
    return (
      <ContaShell
        active="conta"
        kicker="MINHA CONTA"
        customer={customer}
        loading={loading}
        loadError={loadError}
        onRetry={load}
        onLogout={logout}
      />
    );
  }

  const cpf = formatCpf(customer.cpf);
  const phone = formatPhone(customer.phone);

  return (
    <ContaShell
      active="conta"
      kicker="MINHA CONTA"
      customer={customer}
      loading={loading}
      loadError={loadError}
      onRetry={load}
      onLogout={logout}
      avatarVersion={avatarVersion}
    >
      <section className="conta-card" aria-labelledby="dados-title">
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
            <div className="conta-photo">
              <div className="conta-avatar conta-avatar--photo" aria-hidden="true">
                <AvatarFace version={avatarVersion} fallback={initialsOf(customer.name)} />
              </div>
              <div className="conta-photo__body">
                <span className="conta-form-label">Foto de perfil</span>
                <p className="conta-photo__hint">
                  JPG, PNG ou WebP — recortamos em quadrado e reduzimos pra 512px antes de enviar.
                </p>
                {photoMsg && (
                  <p className={`conta-msg ${photoMsg.ok ? "conta-msg--ok" : "conta-msg--err"}`} role="status">
                    {photoMsg.text}
                  </p>
                )}
                <div className="conta-photo__actions">
                  <label className="conta-head-action">
                    <Camera size={13} strokeWidth={2} aria-hidden="true" />
                    {photoBusy ? "Enviando…" : "Trocar foto"}
                    <input
                      className="conta-photo__input"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={onPhotoPick}
                      disabled={photoBusy}
                    />
                  </label>
                  <button
                    type="button"
                    className="conta-head-action"
                    onClick={removePhoto}
                    disabled={photoBusy || !hasAvatar}
                  >
                    <Trash2 size={13} strokeWidth={2} aria-hidden="true" /> Remover
                  </button>
                </div>
              </div>
            </div>
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
                void lookupAfCep(af.zip);
              }}
              error={afErrors.zip}
              touched={afTouched.zip}
              hint={
                afCepStatus === "busy"
                  ? "Buscando CEP na ViaCEP…"
                  : afCepStatus === "ok"
                    ? "Logradouro preenchido — confira e digite o número."
                    : afCepStatus === "miss"
                      ? "CEP fora da base — preencha os campos na mão."
                      : undefined
              }
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
    </ContaShell>
  );
}

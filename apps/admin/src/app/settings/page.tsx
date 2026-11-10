"use client";

// language: TSX, file: apps/admin/src/app/settings/page.tsx, target: Next.js admin
// Configurações da loja: regras comerciais (key `commercial`) e dados da
// empresa (key `empresa_dados`) em system_settings. PUT substitui o objeto
// inteiro — o formulário carrega o valor atual, edita e salva completo,
// para nunca apagar um campo que a loja lê.
import { useCallback, useEffect, useState } from "react";
import { adminJson, messageOf } from "../../lib/api";
import { useGateRedirect } from "../../lib/useGate";

type Commercial = {
  pix_discount_percent: number;
  installments: number;
  installment_interest_free: boolean;
  min_installment_cents: number;
  free_shipping_from_cents: number;
  shipping_carriers: string[];
  whatsapp: string;
  email: string;
  address: { street: string; district: string; city: string; state: string; zip: string };
  service_hours: string;
  social: { instagram: string; whatsapp: string };
  announcement: string;
};

type Empresa = {
  nome_fantasia: string;
  razao_social: string;
  cnpj: string;
  telefone_principal: string;
  email_contato: string;
};

type SettingRow = { key: string; value: unknown };

type CommForm = {
  pix: string;
  inst: string;
  noInterest: boolean;
  minInst: string;
  freeShip: string;
  carriers: string;
  announcement: string;
  hours: string;
  whatsapp: string;
  email: string;
  street: string;
  district: string;
  city: string;
  state: string;
  zip: string;
  instagram: string;
  socialWhatsapp: string;
};

const EMPTY_COMM: CommForm = {
  pix: "0", inst: "1", noInterest: false, minInst: "0.00", freeShip: "0.00",
  carriers: "", announcement: "", hours: "", whatsapp: "", email: "",
  street: "", district: "", city: "", state: "", zip: "", instagram: "", socialWhatsapp: "",
};

const EMPTY_EMPRESA: Empresa = {
  nome_fantasia: "", razao_social: "", cnpj: "", telefone_principal: "", email_contato: "",
};

function centsToInput(cents: unknown): string {
  const n = Number(cents);
  return Number.isFinite(n) && n > 0 ? (n / 100).toFixed(2) : "0.00";
}

function inputToCents(v: string): number {
  const n = Number(v.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

function num(v: string, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<unknown>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const [comm, setComm] = useState<CommForm>(EMPTY_COMM);
  const [empresa, setEmpresa] = useState<Empresa>(EMPTY_EMPRESA);
  useGateRedirect(failure);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await adminJson<{ items?: SettingRow[] }>("/api/admin/settings");
      const rows = payload.items ?? [];

      const c = (rows.find((r) => r.key === "commercial")?.value ?? {}) as Partial<Commercial>;
      setComm({
        pix: String(c.pix_discount_percent ?? 0),
        inst: String(c.installments ?? 1),
        noInterest: Boolean(c.installment_interest_free),
        minInst: centsToInput(c.min_installment_cents),
        freeShip: centsToInput(c.free_shipping_from_cents),
        carriers: Array.isArray(c.shipping_carriers) ? c.shipping_carriers.join(", ") : "",
        announcement: c.announcement ?? "",
        hours: c.service_hours ?? "",
        whatsapp: c.whatsapp ?? "",
        email: c.email ?? "",
        street: c.address?.street ?? "",
        district: c.address?.district ?? "",
        city: c.address?.city ?? "",
        state: c.address?.state ?? "",
        zip: c.address?.zip ?? "",
        instagram: c.social?.instagram ?? "",
        socialWhatsapp: c.social?.whatsapp ?? "",
      });

      const e = (rows.find((r) => r.key === "empresa_dados")?.value ?? {}) as Partial<Empresa>;
      setEmpresa({
        nome_fantasia: e.nome_fantasia ?? "",
        razao_social: e.razao_social ?? "",
        cnpj: e.cnpj ?? "",
        telefone_principal: e.telefone_principal ?? "",
        email_contato: e.email_contato ?? "",
      });
      setFailure(null);
    } catch (err) {
      setFailure(err);
      setError(messageOf(err, "Falha ao carregar as configurações."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function saveCommercial(ev: React.FormEvent) {
    ev.preventDefault();
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const value: Commercial = {
        pix_discount_percent: num(comm.pix, 0, 100, 0),
        installments: Math.round(num(comm.inst, 1, 24, 1)),
        installment_interest_free: comm.noInterest,
        min_installment_cents: inputToCents(comm.minInst),
        free_shipping_from_cents: inputToCents(comm.freeShip),
        shipping_carriers: comm.carriers.split(",").map((s) => s.trim()).filter(Boolean),
        whatsapp: comm.whatsapp.trim(),
        email: comm.email.trim(),
        address: {
          street: comm.street.trim(),
          district: comm.district.trim(),
          city: comm.city.trim(),
          state: comm.state.trim().toUpperCase(),
          zip: comm.zip.trim(),
        },
        service_hours: comm.hours.trim(),
        social: { instagram: comm.instagram.trim(), whatsapp: comm.socialWhatsapp.trim() },
        announcement: comm.announcement.trim(),
      };
      await adminJson("/api/admin/settings/commercial", {
        method: "PUT",
        body: JSON.stringify({ value }),
      });
      setNotice("Condições comerciais salvas. A loja inteira passa a usar os novos valores na hora.");
    } catch (err) {
      setFailure(err);
      setError(messageOf(err, "Falha ao salvar as condições comerciais."));
    } finally {
      setBusy(false);
    }
  }

  async function saveEmpresa(ev: React.FormEvent) {
    ev.preventDefault();
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const value: Empresa = {
        nome_fantasia: empresa.nome_fantasia.trim(),
        razao_social: empresa.razao_social.trim(),
        cnpj: empresa.cnpj.trim(),
        telefone_principal: empresa.telefone_principal.trim(),
        email_contato: empresa.email_contato.trim(),
      };
      await adminJson("/api/admin/settings/empresa_dados", {
        method: "PUT",
        body: JSON.stringify({ value }),
      });
      setNotice("Dados da empresa salvos. O rodapé da loja atualiza na hora.");
    } catch (err) {
      setFailure(err);
      setError(messageOf(err, "Falha ao salvar os dados da empresa."));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="px-6 pb-24">
        <p className="font-mono text-xs text-[#666]" role="status">Carregando configurações…</p>
      </main>
    );
  }

  return (
    <main className="px-6 pb-24">
      <div className="admin-section-head">
        <div>
          <span className="admin-section-head__kicker">Loja</span>
          <h1 className="admin-section-head__title">Configurações</h1>
          <p className="admin-section-head__subtitle">
            Fonte única das regras da loja: o que você salvar aqui aparece no topo, na home, no
            checkout, no rastreamento e nas páginas de termos — sem valor repetido em código.
          </p>
        </div>
      </div>

      {error ? <p className="admin-notice admin-notice--err" role="alert">{error}</p> : null}
      {notice ? <p className="admin-notice admin-notice--ok" role="status">{notice}</p> : null}

      <form onSubmit={saveCommercial} className="mb-14">
        <div className="admin-section-head">
          <div>
            <span className="admin-section-head__kicker">Regras comerciais</span>
            <h2 className="admin-section-head__title" style={{ fontSize: "1.15rem" }}>Desconto, parcelamento e frete</h2>
          </div>
        </div>

        <div className="admin-form grid grid-cols-1 md:grid-cols-4 gap-4 items-end mb-6">
          <div className="field">
            <label htmlFor="st-pix">Desconto PIX (%)</label>
            <input id="st-pix" className="input w-full" type="number" min={0} max={100} step={1}
              value={comm.pix} onChange={(e) => setComm({ ...comm, pix: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="st-inst">Parcelas no cartão (até)</label>
            <input id="st-inst" className="input w-full" type="number" min={1} max={24} step={1}
              value={comm.inst} onChange={(e) => setComm({ ...comm, inst: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="st-min">Parcela mínima (R$)</label>
            <input id="st-min" className="input w-full" type="number" min={0} step={0.01}
              value={comm.minInst} onChange={(e) => setComm({ ...comm, minInst: e.target.value })} />
          </div>
          <div className="field flex items-end">
            <label className="font-mono text-[0.65rem] uppercase tracking-widest text-[#666] flex items-center gap-2">
              <input type="checkbox" checked={comm.noInterest}
                onChange={(e) => setComm({ ...comm, noInterest: e.target.checked })} />
              Parcelamento sem juros
            </label>
          </div>

          <div className="field">
            <label htmlFor="st-freeship">Frete grátis a partir de (R$)</label>
            <input id="st-freeship" className="input w-full" type="number" min={0} step={0.01}
              value={comm.freeShip} onChange={(e) => setComm({ ...comm, freeShip: e.target.value })} />
          </div>
          <div className="field md:col-span-2">
            <label htmlFor="st-carriers">Transportadoras (separadas por vírgula)</label>
            <input id="st-carriers" className="input w-full" placeholder="Correios PAC, SEDEX"
              value={comm.carriers} onChange={(e) => setComm({ ...comm, carriers: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="st-hours">Horário de atendimento</label>
            <input id="st-hours" className="input w-full" placeholder="Seg a Sex 10h–17h"
              value={comm.hours} onChange={(e) => setComm({ ...comm, hours: e.target.value })} />
          </div>

          <div className="field md:col-span-4">
            <label htmlFor="st-announcement">Faixa de anúncio no topo da loja</label>
            <input id="st-announcement" className="input w-full" placeholder="Vazio = faixa oculta"
              value={comm.announcement} onChange={(e) => setComm({ ...comm, announcement: e.target.value })} />
          </div>

          <div className="field">
            <label htmlFor="st-whatsapp">WhatsApp de contato</label>
            <input id="st-whatsapp" className="input w-full" placeholder="5519999999999"
              value={comm.whatsapp} onChange={(e) => setComm({ ...comm, whatsapp: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="st-email">E-mail de contato</label>
            <input id="st-email" className="input w-full" type="email"
              value={comm.email} onChange={(e) => setComm({ ...comm, email: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="st-ig">Instagram</label>
            <input id="st-ig" className="input w-full" placeholder="https://instagram.com/sualoja"
              value={comm.instagram} onChange={(e) => setComm({ ...comm, instagram: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="st-swa">WhatsApp do rodapé</label>
            <input id="st-swa" className="input w-full" placeholder="5519999999999"
              value={comm.socialWhatsapp} onChange={(e) => setComm({ ...comm, socialWhatsapp: e.target.value })} />
          </div>

          <div className="field md:col-span-2">
            <label htmlFor="st-street">Endereço — rua</label>
            <input id="st-street" className="input w-full"
              value={comm.street} onChange={(e) => setComm({ ...comm, street: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="st-district">Bairro</label>
            <input id="st-district" className="input w-full"
              value={comm.district} onChange={(e) => setComm({ ...comm, district: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="st-city">Cidade</label>
            <input id="st-city" className="input w-full"
              value={comm.city} onChange={(e) => setComm({ ...comm, city: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="st-state">UF</label>
            <input id="st-state" className="input w-full" maxLength={2}
              value={comm.state} onChange={(e) => setComm({ ...comm, state: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="st-zip">CEP</label>
            <input id="st-zip" className="input w-full" placeholder="13477-225"
              value={comm.zip} onChange={(e) => setComm({ ...comm, zip: e.target.value })} />
          </div>
        </div>

        <div className="flex items-center gap-4 flex-wrap">
          <button type="submit" className="btn-primary px-6 py-2" disabled={busy}>
            {busy ? "Salvando…" : "Salvar condições comerciais"}
          </button>
          <span className="font-mono text-[0.65rem] text-[#666]">
            Vale para PIX, parcelamento, frete grátis, topbar, home, checkout e termos.
          </span>
        </div>
      </form>

      <form onSubmit={saveEmpresa}>
        <div className="admin-section-head">
          <div>
            <span className="admin-section-head__kicker">Cadastro</span>
            <h2 className="admin-section-head__title" style={{ fontSize: "1.15rem" }}>Dados da empresa (rodapé)</h2>
          </div>
        </div>

        <div className="admin-form grid grid-cols-1 md:grid-cols-4 gap-4 items-end mb-6">
          <div className="field">
            <label htmlFor="em-fantasia">Nome fantasia</label>
            <input id="em-fantasia" className="input w-full"
              value={empresa.nome_fantasia} onChange={(e) => setEmpresa({ ...empresa, nome_fantasia: e.target.value })} />
          </div>
          <div className="field md:col-span-2">
            <label htmlFor="em-razao">Razão social</label>
            <input id="em-razao" className="input w-full"
              value={empresa.razao_social} onChange={(e) => setEmpresa({ ...empresa, razao_social: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="em-cnpj">CNPJ</label>
            <input id="em-cnpj" className="input w-full" placeholder="00.000.000/0000-00"
              value={empresa.cnpj} onChange={(e) => setEmpresa({ ...empresa, cnpj: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="em-phone">Telefone principal</label>
            <input id="em-phone" className="input w-full"
              value={empresa.telefone_principal} onChange={(e) => setEmpresa({ ...empresa, telefone_principal: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="em-email">E-mail de contato</label>
            <input id="em-email" className="input w-full" type="email"
              value={empresa.email_contato} onChange={(e) => setEmpresa({ ...empresa, email_contato: e.target.value })} />
          </div>
        </div>

        <div className="flex items-center gap-4 flex-wrap">
          <button type="submit" className="btn-primary px-6 py-2" disabled={busy}>
            {busy ? "Salvando…" : "Salvar dados da empresa"}
          </button>
          <span className="font-mono text-[0.65rem] text-[#666]">
            Razão social e CNPJ saem no rodapé de todas as páginas da loja.
          </span>
        </div>
      </form>
    </main>
  );
}

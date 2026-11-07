"use client";

import { useCallback, useEffect, useState } from "react";
import { adminJson, messageOf } from "../../lib/api";
import { useGateRedirect } from "../../lib/useGate";

const ROLES = [
  "superadmin",
  "gerente",
  "estoque",
  "atendimento",
  "marketing",
  "financeiro",
  "somente-leitura",
] as const;

type Operator = {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  mfaEnabled: boolean;
  needsRoleReview: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

type UsersPayload = {
  items: Operator[];
  actor: { id: string | null; role: string | null };
};

type SessionRow = {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
};

type InviteRow = {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
  status: "active" | "expired" | "used";
};

type InvitePayload = {
  invite: { id: string; email: string; role: string; expiresAt: string; token: string };
};

type PasskeyRow = {
  id: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
};

function fmt(v: string | null | undefined) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString("pt-BR");
  } catch {
    return v;
  }
}

export default function UsersPage() {
  const [data, setData] = useState<UsersPayload | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [passkeys, setPasskeys] = useState<PasskeyRow[]>([]);
  const [regenCodes, setRegenCodes] = useState<string[] | null>(null);
  const [copiedCodes, setCopiedCodes] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<unknown>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [invite, setInvite] = useState<InvitePayload["invite"] | null>(null);
  const [inviteForm, setInviteForm] = useState({ email: "", role: "atendimento" });
  const [busy, setBusy] = useState(false);
  useGateRedirect(failure);

  const loadInvites = useCallback(async () => {
    try {
      const p = await adminJson<{ items: InviteRow[] }>("/api/admin/invites");
      setInvites(p.items ?? []);
    } catch {
      setInvites([]);
    }
  }, []);

  const loadSessions = useCallback(async () => {
    try {
      const payload = await adminJson<{ items: SessionRow[] }>("/api/admin/sessions");
      setSessions(payload.items ?? []);
    } catch {
      setSessions([]);
    }
  }, []);

  const loadPasskeys = useCallback(async () => {
    try {
      const p = await adminJson<{ items: PasskeyRow[] }>("/api/admin/mfa/webauthn/credentials");
      setPasskeys(p.items ?? []);
    } catch {
      setPasskeys([]);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await adminJson<UsersPayload>("/api/admin/users");
      setData(payload);
      setFailure(null);
      setError("");
      await Promise.all([loadSessions(), loadPasskeys()]);
      if (payload.actor?.role === "superadmin") await loadInvites();
    } catch (e) {
      setFailure(e);
      setError(messageOf(e, "Falha ao carregar operadores."));
    } finally {
      setLoading(false);
    }
  }, [loadInvites, loadPasskeys, loadSessions]);

  useEffect(() => {
    load();
  }, [load]);

  async function changeRole(id: string, role: string, name: string) {
    if (!window.confirm(`Confirmar alteração de papel de "${name}" para "${role}"?`)) {
      await load();
      return;
    }
    setError("");
    try {
      await adminJson(`/api/admin/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ role, confirm: true }),
      });
      setNotice("Papel atualizado.");
      await load();
    } catch (e) {
      setError(messageOf(e, "Falha ao alterar o papel."));
      await load();
    }
  }

  async function createInvite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setInvite(null);
    try {
      const payload = await adminJson<InvitePayload>("/api/admin/invites", {
        method: "POST",
        body: JSON.stringify({
          email: inviteForm.email.trim().toLowerCase(),
          role: inviteForm.role,
        }),
      });
      setInvite(payload.invite);
      setInviteForm({ email: "", role: "atendimento" });
      await loadInvites();
    } catch (e) {
      setError(messageOf(e, "Falha ao criar o convite."));
    } finally {
      setBusy(false);
    }
  }

  async function revokeInvite(id: string, email: string) {
    if (!window.confirm(`Revogar o convite de ${email}?`)) return;
    setError("");
    try {
      await adminJson(`/api/admin/invites/${id}`, { method: "DELETE" });
      setNotice("Convite revogado.");
      await loadInvites();
    } catch (e) {
      setError(messageOf(e, "Falha ao revogar o convite."));
    }
  }

  async function revokeSession(id: string) {
    if (!window.confirm("Revogar esta sessão?")) return;
    setError("");
    try {
      await adminJson(`/api/admin/sessions/${id}`, { method: "DELETE" });
      setNotice("Sessão revogada.");
      await loadSessions();
    } catch (e) {
      setError(messageOf(e, "Falha ao revogar a sessão."));
    }
  }

  async function revokeOthers() {
    if (!window.confirm("Revogar todas as outras sessões? Você permanecerá conectado apenas nesta sessão.")) return;
    setError("");
    try {
      const res = await adminJson<{ revoked: number }>("/api/admin/sessions/revoke-others", {
        method: "POST",
        body: JSON.stringify({ confirm: true }),
      });
      setNotice(`Outras sessões revogadas: ${res.revoked}.`);
      await loadSessions();
    } catch (e) {
      setError(messageOf(e, "Falha ao revogar as outras sessões."));
    }
  }

  async function renamePasskey(id: string, current: string | null) {
    const label = window.prompt("Novo nome da passkey:", current || "Passkey");
    if (label === null) return;
    setError("");
    try {
      await adminJson(`/api/admin/mfa/webauthn/credentials/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ label: label.trim() || "Passkey" }),
      });
      setNotice("Passkey renomeada.");
      await loadPasskeys();
    } catch (e: any) {
      if (e?.code === "reauth_required") {
        const code = window.prompt("Reautenticação necessária. Informe o código TOTP atual:");
        if (!code) return;
        try {
          await adminJson(`/api/admin/mfa/webauthn/credentials/${id}`, {
            method: "PATCH",
            body: JSON.stringify({ label: label.trim() || "Passkey", totpCode: code.trim() }),
          });
          setNotice("Passkey renomeada.");
          await loadPasskeys();
        } catch (e2) {
          setError(messageOf(e2, "Falha ao renomear a passkey."));
        }
        return;
      }
      setError(messageOf(e, "Falha ao renomear a passkey."));
    }
  }

  async function removePasskey(id: string, label: string | null) {
    if (!window.confirm(`Remover a passkey "${label || "Passkey"}"?`)) return;
    setError("");
    try {
      await adminJson(`/api/admin/mfa/webauthn/credentials/${id}`, { method: "DELETE", body: JSON.stringify({}) });
      setNotice("Passkey removida.");
      await loadPasskeys();
    } catch (e: any) {
      if (e?.code === "reauth_required") {
        const code = window.prompt("Reautenticação necessária. Informe o código TOTP atual:");
        if (!code) return;
        try {
          await adminJson(`/api/admin/mfa/webauthn/credentials/${id}`, {
            method: "DELETE",
            body: JSON.stringify({ totpCode: code.trim() }),
          });
          setNotice("Passkey removida.");
          await loadPasskeys();
        } catch (e2) {
          setError(messageOf(e2, "Falha ao remover a passkey."));
        }
        return;
      }
      setError(messageOf(e, "Falha ao remover a passkey."));
    }
  }

  async function registerPasskey() {
    setError("");
    setBusy(true);
    try {
      const { startRegistration } = await import("@simplewebauthn/browser");
      const options = await adminJson<Record<string, unknown>>("/api/admin/mfa/webauthn/register/options", { method: "POST" });
      const response = await startRegistration({ optionsJSON: options as never });
      const res = await adminJson<{ ok: boolean; recoveryCodes?: string[] }>("/api/admin/mfa/webauthn/register/verify", {
        method: "POST",
        body: JSON.stringify(response),
      });
      if (res.recoveryCodes?.length) setRegenCodes(res.recoveryCodes);
      setNotice("Passkey cadastrada.");
      await loadPasskeys();
    } catch (e: any) {
      if (e?.name === "NotAllowedError") setError("Cadastro de passkey cancelado.");
      else setError(messageOf(e, "Não foi possível cadastrar a passkey neste dispositivo/navegador."));
    } finally {
      setBusy(false);
    }
  }

  async function regenerateRecovery() {
    if (!window.confirm("Regenerar códigos de recuperação? Os códigos atuais deixarão de funcionar.")) return;
    setError("");
    try {
      const res = await adminJson<{ recoveryCodes?: string[] }>("/api/admin/mfa/recovery/regenerate", {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (res.recoveryCodes?.length) setRegenCodes(res.recoveryCodes);
      setNotice("Códigos de recuperação regenerados.");
    } catch (e: any) {
      if (e?.code === "reauth_required") {
        const code = window.prompt("Reautenticação necessária. Informe o código TOTP atual:");
        if (!code) return;
        try {
          const res = await adminJson<{ recoveryCodes?: string[] }>("/api/admin/mfa/recovery/regenerate", {
            method: "POST",
            body: JSON.stringify({ totpCode: code.trim() }),
          });
          if (res.recoveryCodes?.length) setRegenCodes(res.recoveryCodes);
          setNotice("Códigos de recuperação regenerados.");
        } catch (e2) {
          setError(messageOf(e2, "Falha ao regenerar códigos."));
        }
        return;
      }
      setError(messageOf(e, "Falha ao regenerar códigos de recuperação."));
    }
  }

  async function copyRegenCodes() {
    if (!regenCodes) return;
    try {
      await navigator.clipboard.writeText(regenCodes.join("\n"));
      setCopiedCodes(true);
      setTimeout(() => setCopiedCodes(false), 2000);
    } catch {}
  }

  const isSuper = data?.actor?.role === "superadmin";
  const actorId = data?.actor?.id;

  if (loading) {
    return (
      <main className="px-6 pb-24">
        <div className="grid grid-cols-1 gap-4">
          <div className="h-20 bg-[#0a0a0a] border border-[#111]" />
          <div className="h-20 bg-[#0a0a0a] border border-[#111]" />
        </div>
      </main>
    );
  }

  return (
    <main className="px-6 pb-24">
      <header className="mb-12 border-b border-[#111] pb-6">
        <h1 className="font-display font-black text-3xl md:text-4xl uppercase leading-none tracking-tighter text-white">
          Operadores e acessos
        </h1>
        <p className="font-mono text-[0.65rem] uppercase tracking-widest text-[#666] mt-2">
          Papéis, MFA, passkeys, convites e sessões
        </p>
      </header>

      {error ? (
        <p role="alert" className="text-[#dc2626] font-mono text-xs font-bold mb-6">{error}</p>
      ) : null}
      {notice ? <p className="text-[#8bcf16] font-mono text-xs font-bold mb-6">{notice}</p> : null}

      {regenCodes ? (
        <section className="mb-14 border border-[#8bcf16] bg-[#050505] p-8 max-w-2xl">
          <span className="font-mono text-xs uppercase tracking-widest text-[#8bcf16] block mb-3">Códigos de recuperação</span>
          <p className="font-mono text-xs text-[#dc2626] font-bold uppercase tracking-wider mb-4">
            Aviso: exibidos uma única vez. Não poderão ser mostrados novamente.
          </p>
          <ul className="grid grid-cols-2 gap-3 font-mono text-sm text-white">
            {regenCodes.map((c) => <li key={c} className="border border-[#111] px-3 py-2 tracking-wider">{c}</li>)}
          </ul>
          <div className="flex gap-4 mt-6 flex-wrap">
            <button type="button" onClick={copyRegenCodes} className="btn-secondary px-6 py-3 border border-[#8bcf16] text-[#8bcf16]">{copiedCodes ? "Copiado" : "Copiar códigos"}</button>
            <button type="button" onClick={() => setRegenCodes(null)} className="btn-secondary px-6 py-3 border border-[#111] text-[#666]">Fechar</button>
          </div>
        </section>
      ) : null}

      <section className="mb-14">
        <span className="font-mono text-xs uppercase tracking-widest text-[#8bcf16] block mb-4">Time do painel</span>
        {(data?.items.length ?? 0) === 0 ? (
          <div className="border border-[#111] bg-[#0a0a0a] p-12 text-center">
            <h2 className="font-display font-black text-2xl uppercase text-white mb-2">Nenhum operador</h2>
            <p className="text-[#666] font-mono text-xs">Convide o primeiro operador para o painel.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>E-mail</th>
                  <th>Papel</th>
                  <th>MFA</th>
                  <th>Último acesso</th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="font-mono text-sm font-bold text-white">
                        {u.name}
                        {u.id === actorId ? <span className="text-[#666] font-normal"> (você)</span> : null}
                      </div>
                      {u.needsRoleReview ? (
                        <span className="font-mono text-[0.6rem] uppercase tracking-widest text-[#dc2626] block mt-1">
                          needs_role_review
                        </span>
                      ) : null}
                    </td>
                    <td className="font-mono text-sm text-white">{u.email}</td>
                    <td>
                      {isSuper && u.id !== actorId ? (
                        <select
                          className="select"
                          value={u.role}
                          aria-label={`Papel de ${u.name}`}
                          onChange={(e) => changeRole(u.id, e.target.value, u.name)}
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>{r}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="font-mono text-sm text-[#666]">
                          {u.role}{u.id === actorId ? " · bloqueado" : ""}
                        </span>
                      )}
                    </td>
                    <td>
                      <span className={`font-mono text-[0.6rem] uppercase font-bold border px-2 py-0.5 ${u.mfaEnabled ? "border-[#8bcf16] text-[#8bcf16]" : "border-[#dc2626] text-[#dc2626]"}`}>
                        {u.mfaEnabled ? "Ativo" : "Pendente"}
                      </span>
                    </td>
                    <td className="font-mono text-sm text-[#666]">{fmt(u.lastLoginAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {isSuper ? (
        <section className="mb-14">
          <span className="font-mono text-xs uppercase tracking-widest text-[#8bcf16] block mb-4">Convites</span>
          <form onSubmit={createInvite} className="border border-[#111] bg-[#0a0a0a] p-6 grid grid-cols-1 md:grid-cols-3 gap-4 items-end max-w-3xl">
            <div className="field">
              <label htmlFor="invite-email">E-mail</label>
              <input id="invite-email" type="email" required className="input w-full" value={inviteForm.email} onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="invite-role">Papel</label>
              <select id="invite-role" className="select w-full" value={inviteForm.role} onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value })}>
                {ROLES.filter((r) => r !== "superadmin").map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn-primary py-3" disabled={busy}>{busy ? "Criando..." : "Gerar convite"}</button>
          </form>

          {invite ? (
            <div className="border border-[#8bcf16] bg-[#050505] p-6 mt-6 max-w-3xl">
              <span className="font-mono text-xs uppercase tracking-widest text-[#8bcf16] block mb-3">Convite de {invite.email}</span>
              <p className="font-mono text-xs text-[#666] mb-3">
                Token de uso único, válido até {fmt(invite.expiresAt)}. Não será exibido novamente após sair desta tela.
              </p>
              <code className="block font-mono text-xs text-white border border-[#111] bg-[#000] px-3 py-2 break-all">
                {`${typeof window !== "undefined" ? window.location.origin : ""}/convite?token=${invite.token}`}
              </code>
            </div>
          ) : null}

          {invites.length > 0 ? (
            <div className="overflow-x-auto mt-6">
              <table>
                <thead>
                  <tr><th>E-mail</th><th>Papel</th><th>Expira</th><th>Status</th><th>Ação</th></tr>
                </thead>
                <tbody>
                  {invites.map((i) => (
                    <tr key={i.id}>
                      <td className="font-mono text-sm text-white">{i.email}</td>
                      <td className="font-mono text-sm text-[#666]">{i.role}</td>
                      <td className="font-mono text-sm text-[#666]">{fmt(i.expiresAt)}</td>
                      <td className="font-mono text-[0.6rem] uppercase text-[#666]">{i.status === "active" ? "Ativo" : i.status === "expired" ? "Expirado" : "Usado"}</td>
                      <td>
                        {i.status === "active" ? (
                          <button type="button" onClick={() => revokeInvite(i.id, i.email)} className="font-mono text-[0.6rem] uppercase font-bold py-1 px-3 border border-[#111] text-[#666] hover:border-[#dc2626] hover:text-[#dc2626]">Revogar</button>
                        ) : <span className="font-mono text-[0.6rem] text-[#333]">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="mb-14">
        <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
          <span className="font-mono text-xs uppercase tracking-widest text-[#8bcf16]">Minhas sessões</span>
          {sessions.length > 1 ? (
            <button type="button" onClick={revokeOthers} className="font-mono text-[0.6rem] uppercase font-bold py-1 px-3 border border-[#111] text-[#666] hover:border-[#dc2626] hover:text-[#dc2626]">
              Revogar outras sessões
            </button>
          ) : null}
        </div>
        {sessions.length === 0 ? (
          <p className="font-mono text-xs text-[#666]">Nenhuma sessão ativa registrada.</p>
        ) : (
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr><th>Dispositivo</th><th>IP</th><th>Início</th><th>Último uso</th><th>Expira</th><th>Ação</th></tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td className="font-mono text-sm text-white">
                      <span className="block max-w-[260px] truncate" title={s.userAgent ?? ""}>{s.userAgent ?? "desconhecido"}</span>
                      {s.current ? <span className="font-mono text-[0.6rem] uppercase tracking-widest text-[#8bcf16] block mt-1">sessão atual</span> : null}
                    </td>
                    <td className="font-mono text-sm text-[#666]">{s.ip ?? "—"}</td>
                    <td className="font-mono text-sm text-[#666]">{fmt(s.createdAt)}</td>
                    <td className="font-mono text-sm text-[#666]">{fmt(s.lastSeenAt)}</td>
                    <td className="font-mono text-sm text-[#666]">{fmt(s.expiresAt)}</td>
                    <td>
                      <button type="button" onClick={() => revokeSession(s.id)} disabled={s.current} className="font-mono text-[0.6rem] uppercase font-bold py-1 px-3 border border-[#111] text-[#666] hover:border-[#dc2626] hover:text-[#dc2626] transition-colors disabled:text-[#333] disabled:hover:border-[#111]">
                        {s.current ? "Atual" : "Revogar"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
          <span className="font-mono text-xs uppercase tracking-widest text-[#8bcf16]">Minhas passkeys</span>
          <div className="flex gap-2 flex-wrap">
            <button type="button" onClick={registerPasskey} disabled={busy} className="font-mono text-[0.6rem] uppercase font-bold py-1 px-3 border border-[#111] text-[#666] hover:border-[#8bcf16] hover:text-[#8bcf16] disabled:text-[#333]">
              {busy ? "Aguarde..." : "Cadastrar passkey"}
            </button>
            <button type="button" onClick={regenerateRecovery} className="font-mono text-[0.6rem] uppercase font-bold py-1 px-3 border border-[#111] text-[#666] hover:border-[#8bcf16] hover:text-[#8bcf16]">
              Regenerar códigos de recuperação
            </button>
          </div>
        </div>
        {passkeys.length === 0 ? (
          <p className="font-mono text-xs text-[#666]">Nenhuma passkey registrada. Use "Cadastrar passkey" neste dispositivo compatível (cancelamento e incompatibilidade são tratados).</p>
        ) : (
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr><th>Nome</th><th>Criada</th><th>Último uso</th><th>Ações</th></tr>
              </thead>
              <tbody>
                {passkeys.map((p) => (
                  <tr key={p.id}>
                    <td className="font-mono text-sm text-white">{p.label || "Passkey"}</td>
                    <td className="font-mono text-sm text-[#666]">{fmt(p.createdAt)}</td>
                    <td className="font-mono text-sm text-[#666]">{fmt(p.lastUsedAt)}</td>
                    <td className="flex gap-2">
                      <button type="button" onClick={() => renamePasskey(p.id, p.label)} className="font-mono text-[0.6rem] uppercase font-bold py-1 px-3 border border-[#111] text-[#666] hover:border-[#8bcf16] hover:text-[#8bcf16]">Renomear</button>
                      <button type="button" onClick={() => removePasskey(p.id, p.label)} className="font-mono text-[0.6rem] uppercase font-bold py-1 px-3 border border-[#111] text-[#666] hover:border-[#dc2626] hover:text-[#dc2626]">Remover</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

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

type InvitePayload = {
  invite: { id: string; email: string; role: string; expiresAt: string; token: string };
};

export default function UsersPage() {
  const [data, setData] = useState<UsersPayload | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<unknown>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [invite, setInvite] = useState<InvitePayload["invite"] | null>(null);
  const [inviteForm, setInviteForm] = useState({ email: "", role: "atendimento" });
  const [busy, setBusy] = useState(false);
  useGateRedirect(failure);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await adminJson<UsersPayload>("/api/admin/users");
      setData(payload);
      setFailure(null);
      setError("");
    } catch (e) {
      setFailure(e);
      setError(messageOf(e, "Falha ao carregar operadores."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    adminJson<{ items: SessionRow[] }>("/api/admin/sessions")
      .then((payload) => setSessions(payload.items ?? []))
      .catch(() => setSessions([]));
  }, []);

  async function changeRole(id: string, role: string) {
    setError("");
    try {
      await adminJson(`/api/admin/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
      setNotice("Papel atualizado.");
      load();
    } catch (e) {
      setError(messageOf(e, "Falha ao alterar o papel."));
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
    } catch (e) {
      setError(messageOf(e, "Falha ao criar o convite."));
    } finally {
      setBusy(false);
    }
  }

  async function revokeSession(id: string) {
    setError("");
    try {
      await adminJson(`/api/admin/sessions/${id}`, { method: "DELETE" });
      const payload = await adminJson<{ items: SessionRow[] }>("/api/admin/sessions");
      setSessions(payload.items ?? []);
    } catch (e) {
      setError(messageOf(e, "Falha ao revogar a sessão."));
    }
  }

  const isSuper = data?.actor?.role === "superadmin";

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
          Papéis, segundo fator e sessões ativas
        </p>
      </header>

      {error ? (
        <p role="alert" className="text-[#dc2626] font-mono text-xs font-bold mb-6">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="text-[#8bcf16] font-mono text-xs font-bold mb-6">{notice}</p>
      ) : null}

      <section className="mb-14">
        <span className="font-mono text-xs uppercase tracking-widest text-[#8bcf16] block mb-4">
          Time do painel
        </span>
        {(data?.items.length ?? 0) === 0 ? (
          <div className="border border-[#111] bg-[#0a0a0a] p-12 text-center">
            <div className="font-mono font-black text-6xl uppercase tracking-tighter text-[#8bcf16] mb-6 inline-block">
              0
            </div>
            <h2 className="font-display font-black text-3xl uppercase leading-none tracking-tighter text-white mb-4">
              Nenhum operador
            </h2>
            <p className="text-[#666] font-mono text-xs max-w-md mx-auto">
              Convide o primeiro operador para o painel.
            </p>
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
                      <div className="font-mono text-sm font-bold text-white">{u.name}</div>
                      {u.needsRoleReview ? (
                        <span className="font-mono text-[0.6rem] uppercase tracking-widest text-[#dc2626] block mt-1">
                          Papel legado · revisar
                        </span>
                      ) : null}
                    </td>
                    <td className="font-mono text-sm text-white">{u.email}</td>
                    <td>
                      {isSuper ? (
                        <select
                          className="select"
                          value={u.role}
                          aria-label={`Papel de ${u.name}`}
                          onChange={(e) => changeRole(u.id, e.target.value)}
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="font-mono text-sm text-[#666]">{u.role}</span>
                      )}
                    </td>
                    <td>
                      <span
                        className={`font-mono text-[0.6rem] uppercase font-bold border px-2 py-0.5 ${
                          u.mfaEnabled
                            ? "border-[#8bcf16] text-[#8bcf16]"
                            : "border-[#dc2626] text-[#dc2626]"
                        }`}
                      >
                        {u.mfaEnabled ? "Ativo" : "Pendente"}
                      </span>
                    </td>
                    <td className="font-mono text-sm text-[#666]">
                      {u.lastLoginAt
                        ? new Date(u.lastLoginAt).toLocaleString("pt-BR")
                        : "nunca"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {isSuper ? (
        <section className="mb-14">
          <span className="font-mono text-xs uppercase tracking-widest text-[#8bcf16] block mb-4">
            Convidar operador
          </span>
          <form
            onSubmit={createInvite}
            className="border border-[#111] bg-[#0a0a0a] p-6 grid grid-cols-1 md:grid-cols-3 gap-4 items-end max-w-3xl"
          >
            <div className="field">
              <label htmlFor="invite-email">E-mail</label>
              <input
                id="invite-email"
                type="email"
                required
                className="input w-full"
                value={inviteForm.email}
                onChange={(e) =>
                  setInviteForm({ ...inviteForm, email: e.target.value })
                }
                placeholder="operador@airsoftamericana.com.br"
              />
            </div>
            <div className="field">
              <label htmlFor="invite-role">Papel</label>
              <select
                id="invite-role"
                className="select w-full"
                value={inviteForm.role}
                onChange={(e) =>
                  setInviteForm({ ...inviteForm, role: e.target.value })
                }
              >
                {ROLES.filter((r) => r !== "superadmin").map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn-primary py-3" disabled={busy}>
              {busy ? "Criando..." : "Gerar convite"}
            </button>
          </form>

          {invite ? (
            <div className="border border-[#8bcf16] bg-[#050505] p-6 mt-6 max-w-3xl">
              <span className="font-mono text-xs uppercase tracking-widest text-[#8bcf16] block mb-3">
                Convite de {invite.email}
              </span>
              <p className="font-mono text-xs text-[#666] mb-3">
                Token de uso único, válido até{" "}
                {new Date(invite.expiresAt).toLocaleString("pt-BR")}. Envie o link
                abaixo para o operador — ele define a senha e ativa o MFA.
              </p>
              <code className="block font-mono text-xs text-white border border-[#111] bg-[#000] px-3 py-2 break-all">
                {`${typeof window !== "undefined" ? window.location.origin : ""}/convite?token=${invite.token}`}
              </code>
            </div>
          ) : null}
        </section>
      ) : null}

      <section>
        <span className="font-mono text-xs uppercase tracking-widest text-[#8bcf16] block mb-4">
          Minhas sessões
        </span>
        {sessions.length === 0 ? (
          <p className="font-mono text-xs text-[#666]">
            Nenhuma sessão ativa registrada.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Dispositivo</th>
                  <th>IP</th>
                  <th>Início</th>
                  <th>Expira</th>
                  <th>Ação</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td className="font-mono text-sm text-white">
                      {s.userAgent ?? "desconhecido"}
                      {s.current ? (
                        <span className="font-mono text-[0.6rem] uppercase tracking-widest text-[#8bcf16] block mt-1">
                          sessão atual
                        </span>
                      ) : null}
                    </td>
                    <td className="font-mono text-sm text-[#666]">{s.ip ?? "—"}</td>
                    <td className="font-mono text-sm text-[#666]">
                      {new Date(s.createdAt).toLocaleString("pt-BR")}
                    </td>
                    <td className="font-mono text-sm text-[#666]">
                      {new Date(s.expiresAt).toLocaleString("pt-BR")}
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => revokeSession(s.id)}
                        disabled={s.current}
                        className="font-mono text-[0.6rem] uppercase font-bold py-1 px-3 border border-[#111] text-[#666] hover:border-[#dc2626] hover:text-[#dc2626] transition-colors disabled:text-[#333] disabled:hover:border-[#111]"
                      >
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
    </main>
  );
}

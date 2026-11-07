"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export function AddToCart({ variantId }: { variantId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function add() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${API_URL}/api/cart/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ variantId, quantity: 1 }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) {
        setError(json.error?.message ?? "Falha ao adicionar.");
        return;
      }
      setDone(true);
      router.refresh();
    } catch {
      setError("Erro de conexão com a API.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {error && (
        <p role="alert" className="text-sm font-semibold mb-3" style={{ color: "var(--destructive)" }}>{error}</p>
      )}
      {done && (
        <p className="text-sm font-bold mb-3" style={{ color: "var(--accent)" }}>No carrinho! Veja em /cart.</p>
      )}
      <button type="button" className="btn-primary btn-lg" disabled={busy} onClick={add}>
        {busy ? "Adicionando..." : "Adicionar ao carrinho"}
      </button>
    </div>
  );
}

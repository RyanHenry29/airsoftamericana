"use client";

import { useEffect, useState } from "react";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type Category = { id: string; name: string; slug: string; ageRestricted: boolean; active: boolean; parentId: string | null; position: number };

export default function CategoriesPage() {
  const [items, setItems] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`${API_URL}/api/store/categories`, { credentials: "include" });
        if (!res.ok) {
          setError("Falha ao carregar categorias.");
          return;
        }
        const json = (await res.json()) as Category[];
        setItems(Array.isArray(json) ? json : []);
      } catch {
        setError("Erro de conexão com a API.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

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

  if (error) {
    return (
      <main className="px-6 py-24 text-center">
        <div className="font-mono font-black text-6xl uppercase tracking-tighter text-[#dc2626] mb-6">
          ERR
        </div>
        <h1 className="font-display font-black text-4xl md:text-5xl uppercase leading-none tracking-tighter text-white mb-6">
          Erro ao carregar
        </h1>
        <p className="text-[#666] font-mono text-xs mb-10 max-w-md mx-auto">{error}</p>
      </main>
    );
  }

  return (
    <main className="px-6 pb-24">
      <header className="mb-12 border-b border-[#111] pb-6">
        <h1 className="font-display font-black text-3xl md:text-4xl uppercase leading-none tracking-tighter text-white">
          Gestão de Categorias
        </h1>
        <p className="font-mono text-[0.65rem] uppercase tracking-widest text-[#666] mt-2">
          Gerenciar categorias e restrição de idade 18+
        </p>
      </header>

      {items.length === 0 ? (
        <div className="border border-[#111] bg-[#0a0a0a] p-12 text-center">
          <div className="font-mono font-black text-6xl uppercase tracking-tighter text-[#8bcf16] mb-6 inline-block">
            0
          </div>
          <h2 className="font-display font-black text-3xl uppercase leading-none tracking-tighter text-white mb-4">
            Nenhuma categoria ainda
          </h2>
          <p className="text-[#666] font-mono text-xs max-w-md mx-auto mb-8">
            As categorias aparecem aqui quando o seed é executado no banco.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Slug</th>
                <th>Pai</th>
                <th>18+</th>
                <th>Ativo</th>
                <th>Posição</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className="group">
                  <td className="font-mono text-sm font-bold text-white">{c.name}</td>
                  <td className="font-mono text-sm text-[#666]">{c.slug}</td>
                  <td className="font-mono text-sm text-[#666]">{c.parentId ?? "—"}</td>
                  <td>
                    <span className={`font-mono text-[0.6rem] uppercase font-bold border px-2 py-0.5 ${c.ageRestricted ? "border-[#8bcf16] text-[#8bcf16]" : "border-[#333] text-[#333]"}`}>
                      {c.ageRestricted ? "Sim" : "Não"}
                    </span>
                  </td>
                  <td>
                    <span className={`font-mono text-[0.6rem] uppercase font-bold border px-2 py-0.5 ${c.active ? "border-[#8bcf16] text-[#8bcf16]" : "border-[#333] text-[#333]"}`}>
                      {c.active ? "Sim" : "Não"}
                    </span>
                  </td>
                  <td className="font-mono text-sm text-[#666]">{c.position}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

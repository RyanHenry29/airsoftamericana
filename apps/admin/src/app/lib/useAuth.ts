// language: TS, file: apps/admin/src/app/lib/useAuth.ts, target: Next.js admin
// Hook de autenticação do painel: busca /api/admin/me e expõe user/role.
"use client";

import { useEffect, useState } from "react";
import { adminJson } from "../../lib/api";

type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  mfaEnabled: boolean;
};

export function useAuth() {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const json = await adminJson<{ user?: AdminUser }>("/api/admin/me");
        if (alive) {
          setUser(json.user ?? null);
        }
      } catch {
        if (alive) setUser(null);
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, []);

  return { user, loading };
}
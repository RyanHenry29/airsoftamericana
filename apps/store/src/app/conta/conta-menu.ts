// language: TS, file: apps/store/src/app/conta/conta-menu.ts, target: Next.js App Router (client)
// Menu lateral da conta — fonte única dos dois acessos (/conta e /conta/pedidos).
// O item ativo vem da rota: cada acesso marca o próprio link.
import type { ElementType } from "react";
import { ClipboardList, Headset, IdCard, LogOut, Truck } from "lucide-react";
import { API_URL } from "../lib/store";

export type Customer = {
  id: string;
  name: string;
  email: string;
  cpf?: string | null;
  phone?: string | null;
  createdAt?: string | null;
};

export type MenuLink = {
  kind: "link";
  label: string;
  href: string;
  icon: ElementType;
  active?: boolean;
};

export type MenuAction = {
  kind: "action";
  label: string;
  action: "logout";
  icon: ElementType;
};

export type MenuItem = MenuLink | MenuAction;

export type ContaActiveKey = "conta" | "pedidos";

export function menuFor(active: ContaActiveKey, authed: boolean): MenuItem[] {
  const items: MenuItem[] = [
    { kind: "link", label: "Minha conta", href: "/conta", icon: IdCard, active: active === "conta" },
    { kind: "link", label: "Meus pedidos", href: "/conta/pedidos", icon: ClipboardList, active: active === "pedidos" },
    { kind: "link", label: "Rastrear pedido", href: "/rastreamento", icon: Truck },
    { kind: "link", label: "Atendimento", href: "/atendimento", icon: Headset },
  ];
  if (authed) items.push({ kind: "action", label: "Sair da conta", action: "logout", icon: LogOut });
  return items;
}

/** Joana Pereira → JP: no máximo duas letras, no quadro do cabeçalho. */
export function initialsOf(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

/** Encerra a sessão do cliente e volta pra home — mesmo fluxo nos dois acessos. */
export async function logoutAccount(router: { push: (href: string) => void; refresh: () => void }) {
  await fetch(`${API_URL}/api/auth/logout`, { method: "POST", credentials: "include" }).catch(() => {});
  router.push("/");
  router.refresh();
}

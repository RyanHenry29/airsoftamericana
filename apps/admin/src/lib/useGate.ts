"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { gateOf } from "./api";

/**
 * A API barra a tela em três casos: sessão inválida (401), MFA não ativado
 * (MFA_SETUP_REQUIRED) e MFA não verificado na sessão (MFA_VERIFY_REQUIRED).
 * A tela redireciona para o lugar certo em vez de mostrar "erro ao carregar".
 */
export function useGateRedirect(error: unknown): void {
  const router = useRouter();
  const gate = gateOf(error);
  useEffect(() => {
    if (gate === "mfa-setup") router.replace("/mfa/setup");
    else if (gate === "mfa-verify") router.replace("/mfa/verify");
    else if (gate === "unauth") router.replace("/login");
  }, [gate, router]);
}

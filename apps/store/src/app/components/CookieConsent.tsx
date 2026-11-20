"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  COOKIE_CONSENT_KEY,
  COOKIE_DISMISSED_CLASS,
  COOKIE_PREFS_EVENT,
  type CookieChoice,
} from "../lib/cookie-consent";

type Choice = CookieChoice;

function storedChoice(): Choice | null {
  try {
    const v = localStorage.getItem(COOKIE_CONSENT_KEY);
    return v === "accepted" || v === "rejected" ? v : null;
  } catch {
    return null;
  }
}

export function CookieConsent() {
  // O aviso nasce no HTML do servidor. Antes ele só existia depois da
  // hidratação (useState(false) -> useEffect), e no catálogo esse parágrafo
  // pintava aos 4,4 s e virava o LCP da página. O script inline do layout
  // esconde, antes da primeira pintura, quem já registrou a escolha.
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (storedChoice()) setVisible(false);
    const reopen = () => {
      document.documentElement.classList.remove(COOKIE_DISMISSED_CLASS);
      setVisible(true);
    };
    window.addEventListener(COOKIE_PREFS_EVENT, reopen);
    return () => window.removeEventListener(COOKIE_PREFS_EVENT, reopen);
  }, []);

  function choose(choice: Choice) {
    try {
      localStorage.setItem(COOKIE_CONSENT_KEY, choice);
      document.cookie = `${COOKIE_CONSENT_KEY}=${choice}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
    } catch {
      /* storage indisponível */
    }
    document.documentElement.classList.add(COOKIE_DISMISSED_CLASS);
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      className="cookie-consent"
      role="dialog"
      aria-live="polite"
      aria-label="Preferências de cookies e armazenamento local"
    >
      <div className="cookie-consent__inner">
        <div className="cookie-consent__text">
          <p className="cookie-consent__title">Cookies e armazenamento local</p>
          <p className="cookie-consent__desc">
            Usamos armazenamento essencial para sessão, carrinho e segurança. Itens não essenciais só com sua permissão.{" "}
            <Link href="/privacidade" className="cookie-consent__link">Privacidade</Link>.
          </p>
        </div>
        <div className="cookie-consent__actions">
          <button type="button" className="cookie-consent__btn cookie-consent__btn--ghost" onClick={() => choose("rejected")}>
            Recusar não essenciais
          </button>
          <button type="button" className="cookie-consent__btn cookie-consent__btn--primary" onClick={() => choose("accepted")}>
            Aceitar
          </button>
        </div>
      </div>
    </div>
  );
}

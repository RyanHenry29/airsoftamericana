"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const KEY = "aa_cookie_consent_v1";

type Choice = "accepted" | "rejected";

export function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      const v = localStorage.getItem(KEY);
      if (v !== "accepted" && v !== "rejected") setVisible(true);
    } catch {
      setVisible(true);
    }
  }, []);

  function choose(choice: Choice) {
    try {
      localStorage.setItem(KEY, choice);
      document.cookie = `${KEY}=${choice}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
    } catch {
      /* storage indisponível */
    }
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

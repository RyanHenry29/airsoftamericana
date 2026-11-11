// language: TSX, file: apps/store/src/app/components/AutoLayout.tsx, target: Next.js App Router
'use client';

import { useEffect } from 'react';

/**
 * Mede o header em tempo real e expõe --header-h no <html>.
 * Resultado: o mega menu sempre sabe quanto espaço tem, em qualquer
 * resolução, zoom, rotação de tela ou barra de topo (promo bar).
 *
 * Uso: <AutoLayout /> uma vez no layout raiz (apps/store/src/app/layout.tsx)
 * e adicione data-site-header no <header>.
 */
export function AutoLayout({ selector = '[data-site-header]' }: { selector?: string }) {
  useEffect(() => {
    const header = document.querySelector<HTMLElement>(selector);
    if (!header) return;

    const root = document.documentElement;
    let raf = 0;

    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        // bottom = posição real do fim do header (considera barra de topo e scroll)
        const bottom = Math.max(0, Math.round(header.getBoundingClientRect().bottom));
        root.style.setProperty('--header-h', `${bottom}px`);
      });
    };

    update();

    const ro = new ResizeObserver(update);
    ro.observe(header);
    ro.observe(document.body);

    window.addEventListener('resize', update, { passive: true });
    window.addEventListener('scroll', update, { passive: true });
    window.visualViewport?.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update);
      window.visualViewport?.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, [selector]);

  return null;
}

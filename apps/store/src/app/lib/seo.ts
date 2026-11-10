// language: TS, file: apps/store/src/app/lib/seo.ts, target: Next.js App Router
// Helpers de metadados compartilhados entre páginas.
//
// As páginas sobrescrevem o objeto openGraph do layout (merge raso do Next),
// então cada override precisa reapontar o og:image da convenção
// app/opengraph-image.tsx — sem isso o card de compartilhamento some (mural
// em /cadastro e /entrar na auditoria de links).

export const OG_IMAGE = {
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  alt: "Airsoft Americana — réplicas de airsoft, tiro esportivo e equipamentos táticos",
} as const;

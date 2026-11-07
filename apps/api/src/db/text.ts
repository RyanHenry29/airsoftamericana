// language: TS, file: apps/api/src/db/text.ts, target: Fastify 5
/**
 * Higiene de texto importado.
 *
 * O espelho da loja é HTML: nomes e textos chegam escapados ("Muni&ccedil;&atilde;o",
 * "Bon&ecirc;s & Toucas"). Sem decodificar, a vitrine mostra o HTML cru
 * e o produto parece corrompido. Aqui a limpeza é feita uma vez, na entrada.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  ordm: "º",
  ordf: "ª",
  aacute: "á",
  agrave: "à",
  acirc: "â",
  atilde: "ã",
  auml: "ä",
  ccedil: "ç",
  eacute: "é",
  egrave: "è",
  ecirc: "ê",
  euml: "ë",
  iacute: "í",
  igrave: "ì",
  oacute: "ó",
  ocirc: "ô",
  otilde: "õ",
  ouml: "ö",
  uacute: "ú",
  ugrave: "ù",
  ucirc: "û",
  uuml: "ü",
};

/** Decodifica entidades HTML nomeadas e numéricas. */
export function decodeEntities(input: string): string {
  if (!input) return input;
  return input.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const isHex = entity[1]?.toLowerCase() === "x";
      const code = Number.parseInt(isHex ? entity.slice(2) : entity.slice(1), isHex ? 16 : 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    const named = NAMED_ENTITIES[entity.toLowerCase()];
    return named ?? match;
  });
}

/**
 * Nome limpo para exibição: entidades decodificadas, espaços normalizados.
 * Não mexe em caixa, acento ou pontuação — o texto do produto é do lojista.
 */
export function cleanText(input: string | null | undefined): string {
  if (!input) return "";
  return decodeEntities(input)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}
